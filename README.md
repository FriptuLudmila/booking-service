## Booking Service with Google Calendar Integration

This service allows students and teachers to book rooms (main room or kitchen) for their needs and automatically syncs bookings with Google Calendar.

## Booking Service Communication Contract

### Synchronous Communication (REST API)

#### `POST /bookings`

Creates a new booking for a room.

  * **Request Body:**

    ```json
    {
      "userId": "string",
      "room": "string",
      "startTime": "datetime",
      "endTime": "datetime"
    }
    ```

  * **Response (201 Created):**

    ```json
    {
      "bookingId": "string",
      "userId": "string",
      "room": "string",
      "startTime": "datetime",
      "endTime": "datetime",
      "createdAt": "datetime"
    }
    ```

  * **Error Responses:** `400 Bad Request`, `409 Conflict (time slot taken)`

#### `GET /bookings?start={date}&end={date}`

Gets all bookings within a specified date range.

  * **Response (200 OK):**
    ```json
    [
      {
        "bookingId": "string",
        "userId": "string",
        "room": "string",
        "startTime": "datetime",
        "endTime": "datetime"
      }
    ]
    ```

#### `DELETE /bookings/{bookingId}`

Cancels a specific booking.

  * **Response (204 No Content)**
  * **Error Responses:** `403 Forbidden`, `404 Not Found`


# How to run the service


## Prerequisites (Windows)

- **PowerShell**
- **Node.js 18+**
- **Python 3.9+** (for the helper script `run.py`)
- **MongoDB** (running locally or remotely)

---

## Google Calendar Integration Setup - How To

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google Calendar API**:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google Calendar API"
   - Click "Enable"

### 2. Create a Service Account

1. Navigate to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "Service Account"
3. Fill in service account details and click "Create"
4. Grant the service account appropriate roles (optional)
5. Click "Done"

### 3. Generate Service Account Key

1. Click on the newly created service account
2. Go to the "Keys" tab
3. Click "Add Key" > "Create new key"
4. Select "JSON" format
5. Click "Create" - a JSON file will be downloaded
6. Save this file as `google-credentials.json` in your project root

### 4. Share Calendar with Service Account

1. Open [Google Calendar](https://calendar.google.com/)
2. Find the calendar you want to use (or create a new one)
3. Click the three dots next to the calendar name > "Settings and sharing"
4. Under "Share with specific people", click "Add people"
5. Add the service account email (found in your credentials JSON file, looks like `service-account-name@project-id.iam.gserviceaccount.com`)
6. Grant "Make changes to events" permission
7. Click "Send"
8. Note the Calendar ID from "Integrate calendar" section (or use `primary` for your main calendar)

### 5. Configure Environment Variables

Update your [.env](.env) file with:

```env
# Google Calendar Integration (Optional)
GOOGLE_CREDENTIALS_PATH=./google-credentials.json
GOOGLE_CALENDAR_ID=your-calendar-id@group.calendar.google.com
TIMEZONE=America/New_York
```

---



## Run the service (Windows PowerShell)

### Option A — Python helper

```powershell
# normal run
python .\run.py --port 3001

# dev mode with auto-reload
python .\run.py --dev --port 3001
```

### Option B — npm directly

```powershell
npm install
$env:PORT=3001
# set MONGO_URI for this session if not using .env
# $env:MONGO_URI="mongodb://<APP_USER>:<APP_PASS>@localhost:27017/bookingservice?authSource=bookingservice"
npm start
```

**Stop:** press `Ctrl+C` in that window.

---

## Quick health check (PowerShell)

```powershell
irm http://localhost:3001/healthz
# -> ok
```

---

## Quick API checks (PowerShell)

> Open a **new** PowerShell window so the service keeps running in the first one.

```powershell
# 1) Create a booking (now + 1h)
$start=(Get-Date).AddMinutes(5).ToString("o")
$end=(Get-Date).AddMinutes(65).ToString("o")
$body = @{ userId="u1"; room="main"; startTime=$start; endTime=$end } | ConvertTo-Json
irm -Uri "http://localhost:3001/bookings" -Method POST -ContentType "application/json" -Body $body

# 2) List all bookings
irm "http://localhost:3001/bookings"

# 3) List bookings overlapping a range
irm "http://localhost:3001/bookings?start=$start&end=$end"

# 4) Delete the booking (replace with actual bookingId from step 1 response)
# irm -Method DELETE "http://localhost:3001/bookings/<bookingId>"
```

**Negative tests:**

* Overlapping booking → expect **409 Conflict**
* Missing/invalid body → expect **400 Bad Request**
* Deleting unknown `bookingId` → expect **404 Not Found**

---

## Postman 

1. **Import the collection**
   From the **Common Public Repository**, import:

   ```
   postman-collections/FAFCab_Booking_Service.postman_collection.json
   ```

2. **Set collection variable**

   * Open the collection → **Variables**:

     ```
     baseUrl = http://localhost:3001
     ```
   * Save.

3. **Run requests top → bottom**

   * **Healthz** → `200`
   * **Create Booking (valid)** → `201` (stores `bookingId` for later)
   * **Create Booking (overlap)** → `409`
   * **List All** → `200`
   * **List in Range** → `200`
   * **Delete Booking (created)** → `204`
   * **Delete Nonexistent** → `404`
   * **Create Booking (missing fields)** → `400`




