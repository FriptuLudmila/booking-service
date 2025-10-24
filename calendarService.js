import { google } from 'googleapis';
import fs from 'fs';

class CalendarService {
  constructor() {
    this.calendar = null;
    this.calendarId = process.env.BOOKING_GOOGLE_CALENDAR_ID;
  }

  async initialize() {
    try {
      const credentialsPath = process.env.BOOKING_GOOGLE_CREDENTIALS_PATH;

      if (!credentialsPath) {
        console.warn('GOOGLE_CREDENTIALS_PATH not set. Calendar integration disabled.');
        return false;
      }

      if (!fs.existsSync(credentialsPath)) {
        console.warn(`Credentials file not found at ${credentialsPath}. Calendar integration disabled.`);
        return false;
      }

      const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/calendar'],
      });

      this.calendar = google.calendar({ version: 'v3', auth });

      this.calendarId = this.calendarId || 'primary';

      console.log('Google Calendar integration initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize Google Calendar:', error.message);
      return false;
    }
  }

  isEnabled() {
    return this.calendar !== null;
  }

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
      };

      const response = await this.calendar.events.insert({
        calendarId: this.calendarId,
        resource: event,
      });

      console.log(`Calendar event created: ${response.data.id}`);
      return response.data.id;
    } catch (error) {
      console.error('Failed to create calendar event:', error.message);
      return null;
    }
  }

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

  async deleteEventByBookingId(bookingId) {
    if (!this.isEnabled()) {
      console.log('Calendar integration disabled, skipping event deletion');
      return false;
    }

    try {
      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        privateExtendedProperty: `bookingId=${bookingId}`,
      });

      const events = response.data.items || [];

      if (events.length === 0) {
        console.log(`No calendar event found for booking ${bookingId}`);
        return false;
      }

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

export const calendarService = new CalendarService();
