# Vehicle Inspection Portal — Local Demo

A local Node.js demo for collecting vehicle inspection photos/videos, completing the details later, and generating a formatted PDF plus a ZIP archive of original files. The workflow is: create a blank inspection link first → field worker uploads media → admin reviews uploads and enters details → save details → generate or regenerate PDF. The app uses local JSON/file storage for the demo.

## Requirements

- Node.js 18 or newer
- npm

## Run locally

1. Extract the ZIP.
2. Open a terminal in the `vehicle-inspection-portal` folder.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Copy `.env.example` to `.env` and change `ADMIN_PASSWORD` and `SESSION_SECRET` before sharing the app through a public tunnel.
5. Start the app:

   ```bash
   npm start
   ```

6. Open `http://localhost:3000/admin.html`.
7. Default local demo password is `demo123` only if you have not created a `.env` file. For shared demos, set your own `ADMIN_PASSWORD` in `.env`.

## Demo workflow

1. Sign in to the admin dashboard.
2. Click **Create Inspection / Generate Link**. No customer or vehicle details are requested at this stage.
3. Copy the unique inspection upload link and open it on a field worker's phone/browser.
4. Upload photos in the guided sequence and upload a short video.
5. Return to the admin dashboard. Media appears under the same inspection record automatically.
6. Enter and save vehicle/customer/valuation details.
7. Click **Generate PDF Report**. Edit saved details later and regenerate the PDF without uploading media again.
8. Download the PDF or ZIP archive containing original media and the saved data export.

## Storage

- `data.json`: inspection records and report details
- `uploads/<inspection-id>/`: original uploaded photos and videos
- `reports/<inspection-id>-report.pdf`: latest generated PDF for each inspection

This demo has no database or cloud storage. Keep backups of `data.json`, `uploads/`, and `reports/`. All data is stored on the machine running Node.js.

## Security notes

- Admin access uses a session and `ADMIN_PASSWORD`.
- Each upload link has a hard-to-guess token and is restricted to its own inspection.
- The public upload link does not grant access to the admin dashboard or other inspections.
- This is a local demo, not a fully hardened production deployment. Do not expose it publicly with default credentials or real confidential records.
- The upload page can upload to your machine only when the phone can reach the running server. A `localhost` URL does not work from a different device. Use the same Wi-Fi IP for local network tests or a secure temporary tunnel for remote demo access.

## File limits

- Photos: JPG or PNG
- Video: MP4, MOV or WebM
- Maximum individual upload size: 45 MB

## PDF scope

The generated PDF uses a six-page report structure inspired by the supplied sample and supports regenerating the PDF after saved fields change. The QR code and video link can open the uploaded video through the unique inspection token. Review the output against the client's exact report layout before using it for official valuation work. The tool does not independently determine vehicle condition or valuation; those values are entered and verified by the responsible professional.

## Validation

Run `npm run check` for JavaScript syntax checks. Install dependencies with `npm install` before running the server. This project ZIP intentionally excludes `node_modules`, `.env`, and uploaded customer files.
