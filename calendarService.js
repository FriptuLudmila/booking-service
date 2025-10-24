import { google } from 'googleapis';
import fs from 'fs';


/**
 * Google Calendar integration service
 * Manages calendar events for room bookings
 */


class CalendarService {
  constructor() {
    this.calendar = null;
    this.calendarId = process.env.BOOKING_GOOGLE_CALENDAR_ID;
  }


  /**
   * Initialize the Google Calendar API client
   */
  async initialize() {
    try {
      const credentialsPath = process.env.BOOKING_GOOGLE_CREDENTIALS_PATH;

      if (!credentialsPath) {
        console.warn('BOOKING_GOOGLE_CREDENTIALS_PATH not set. Calendar integration disabled.');
        return false;
      }

      console.log(`Looking for credentials at: ${credentialsPath}`);

      if (!fs.existsSync(credentialsPath)) {
        console.warn(`Credentials file not found at ${credentialsPath}. Calendar integration disabled.`);
        return false;
      }

      const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      console.log(`Loaded credentials for service account: ${credentials.client_email || 'unknown'}`);

      // Using service account authentication
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events'],
      });

      this.calendar = google.calendar({ version: 'v3', auth });

      // Use provided calendar ID or 'primary'
      this.calendarId = this.calendarId || 'primary';

      console.log(`Google Calendar integration initialized successfully`);
      console.log(`Target Calendar ID: ${this.calendarId}`);

      // Test the connection by attempting to get calendar info
      try {
        const calendarInfo = await this.calendar.calendars.get({
          calendarId: this.calendarId,
        });
        console.log(`Successfully connected to calendar: ${calendarInfo.data.summary}`);
      } catch (testError) {
        console.error('Calendar connection test failed:', testError.message);
        console.error('Make sure the service account has access to the calendar:', this.calendarId);
        this.calendar = null;
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed to initialize Google Calendar:', error.message);
      console.error('Error details:', error);
      return false;
    }
  }


  /**
   * Check if calendar service is enabled
   */
  isEnabled() {
    return this.calendar !== null;
  }


  /**
   * Create a calendar event for a booking
   * @param {Object} booking - The booking object
   * @returns {Promise<string|null>} - The created event ID or null
   */
  async createEvent(booking) {
    if (!this.isEnabled()) {
      console.log('Calendar integration disabled, skipping event creation');
      return null;
    }

    try {
      const event = {
        summary: `Room Booking: ${booking.room}`,
        description: `Booking by user ${booking.userId}\nBooking ID: ${booking.bookingId}`,
        location: booking.room,
        start: {
          dateTime: booking.startTime.toISOString(),
          timeZone: process.env.BOOKING_TIMEZONE || 'UTC',
        },
        end: {
          dateTime: booking.endTime.toISOString(),
          timeZone: process.env.BOOKING_TIMEZONE || 'UTC',
        },
        extendedProperties: {
          private: {
            bookingId: booking.bookingId,
          },
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 }, // 1 day before
            { method: 'popup', minutes: 30 },      // 30 minutes before
            { method: 'popup', minutes: 10 },      // 10 minutes before
          ],
        },
      };

      console.log(`Creating calendar event for booking ${booking.bookingId} on calendar ${this.calendarId}`);
      console.log(`Event time: ${booking.startTime.toISOString()} to ${booking.endTime.toISOString()}`);

      const response = await this.calendar.events.insert({
        calendarId: this.calendarId,
        resource: event,
        sendUpdates: 'none', // Don't send email notifications
      });

      console.log(`✓ Calendar event created successfully: ${response.data.id}`);
      console.log(`  Event link: ${response.data.htmlLink}`);
      return response.data.id;
    } catch (error) {
      console.error('✗ Failed to create calendar event:', error.message);
      if (error.code) {
        console.error(`  Error code: ${error.code}`);
      }
      if (error.errors) {
        console.error('  Error details:', JSON.stringify(error.errors, null, 2));
      }
      throw error; // Re-throw to let the caller handle it
    }
  }


  /**
   * Delete a calendar event by event ID
   * @param {string} eventId - The Google Calendar event ID
   * @returns {Promise<boolean>} - Success status
   */
  async deleteEventById(eventId) {
    if (!this.isEnabled()) {
      console.log('Calendar integration disabled, skipping event deletion');
      return false;
    }


    if (!eventId) {
      return false;
    }


    try {
      await this.calendar.events.delete({
        calendarId: this.calendarId,
        eventId: eventId,
      });


      console.log(`Calendar event deleted: ${eventId}`);
      return true;
    } catch (error) {
      console.error('Failed to delete calendar event:', error.message);
      return false;
    }
  }


  /**
   * Find and delete calendar event by booking ID
   * @param {string} bookingId - The booking ID
   * @returns {Promise<boolean>} - Success status
   */
  async deleteEventByBookingId(bookingId) {
    if (!this.isEnabled()) {
      console.log('Calendar integration disabled, skipping event deletion');
      return false;
    }


    try {
      // Search for events with matching bookingId in extended properties
      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        privateExtendedProperty: `bookingId=${bookingId}`,
      });


      const events = response.data.items || [];


      if (events.length === 0) {
        console.log(`No calendar event found for booking ${bookingId}`);
        return false;
      }


      // Delete all matching events (should be only one)
      for (const event of events) {
        await this.deleteEventById(event.id);
      }


      return true;
    } catch (error) {
      console.error('Failed to find/delete calendar event:', error.message);
      return false;
    }
  }
}


// Export singleton instance
export const calendarService = new CalendarService();


