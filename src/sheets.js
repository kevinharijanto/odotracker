const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

let sheetsApi = null;
let spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

/**
 * Initialize Google Sheets API
 */
async function initSheets() {
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
        path.join(__dirname, '..', 'credentials.json');

    if (!fs.existsSync(credentialsPath)) {
        console.log('⚠️ Google credentials not found. Sheets sync disabled.');
        return false;
    }

    if (!spreadsheetId || spreadsheetId === 'your_spreadsheet_id_here') {
        console.log('⚠️ Google Sheets spreadsheet ID not configured. Sheets sync disabled.');
        return false;
    }

    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: credentialsPath,
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });

        sheetsApi = google.sheets({ version: 'v4', auth });

        // Ensure sheets exist
        await ensureSheetsExist();

        console.log('✅ Google Sheets API initialized');
        return true;
    } catch (error) {
        console.error('❌ Failed to initialize Google Sheets:', error.message);
        return false;
    }
}

/**
 * Ensure required sheets exist in the spreadsheet
 */
async function ensureSheetsExist() {
    if (!sheetsApi) return;

    try {
        const response = await sheetsApi.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets.properties.title'
        });

        const existingSheets = response.data.sheets.map(s => s.properties.title);
        const requiredSheets = ['Readings', 'Services', 'Vehicles'];

        const requests = [];
        for (const sheetName of requiredSheets) {
            if (!existingSheets.includes(sheetName)) {
                requests.push({
                    addSheet: {
                        properties: { title: sheetName }
                    }
                });
            }
        }

        if (requests.length > 0) {
            await sheetsApi.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: { requests }
            });

            // Add headers
            await addHeaders();
        }
    } catch (error) {
        console.error('Error ensuring sheets exist:', error.message);
    }
}

/**
 * Add headers to sheets
 */
async function addHeaders() {
    if (!sheetsApi) return;

    const headers = {
        'Readings': [['Date', 'User', 'Vehicle', 'Plate', 'Odometer (km)', 'Source']],
        'Services': [['Date', 'User', 'Vehicle', 'Plate', 'Odometer (km)', 'Service Type', 'Notes', 'Cost']],
        'Vehicles': [['User', 'Vehicle Name', 'Plate', 'Service Interval (km)', 'Current Odo', 'Last Service Odo']]
    };

    for (const [sheetName, headerRow] of Object.entries(headers)) {
        try {
            await sheetsApi.spreadsheets.values.update({
                spreadsheetId,
                range: `${sheetName}!A1`,
                valueInputOption: 'RAW',
                requestBody: { values: headerRow }
            });
        } catch (error) {
            console.error(`Error adding headers to ${sheetName}:`, error.message);
        }
    }
}

/**
 * Append an odometer reading to the Readings sheet
 */
async function syncReading(reading, vehicle, user) {
    if (!sheetsApi) return;

    try {
        const date = new Date(reading.created_at).toLocaleString();
        const row = [
            date,
            user.first_name ? (user.username ? `${user.first_name} (@${user.username})` : user.first_name) : user.telegram_id,
            vehicle.name,
            vehicle.plate || '',
            reading.odo_km,
            reading.source
        ];

        await sheetsApi.spreadsheets.values.append({
            spreadsheetId,
            range: 'Readings!A:F',
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: [row] }
        });
    } catch (error) {
        console.error('Error syncing reading to Sheets:', error.message);
    }
}

/**
 * Append a service event to the Services sheet
 */
async function syncService(service, vehicle, user) {
    if (!sheetsApi) return;

    try {
        const date = new Date(service.created_at).toLocaleString();
        const row = [
            date,
            user.first_name ? (user.username ? `${user.first_name} (@${user.username})` : user.first_name) : user.telegram_id,
            vehicle.name,
            vehicle.plate || '',
            service.odo_km,
            service.service_type,
            service.notes || '',
            service.cost ? (service.cost / 100).toFixed(2) : ''
        ];

        await sheetsApi.spreadsheets.values.append({
            spreadsheetId,
            range: 'Services!A:H',
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: [row] }
        });
    } catch (error) {
        console.error('Error syncing service to Sheets:', error.message);
    }
}

/**
 * Update or add vehicle in the Vehicles sheet
 */
async function syncVehicle(vehicle, user) {
    if (!sheetsApi) return;

    try {
        const userName = user.first_name ? (user.username ? `${user.first_name} (@${user.username})` : user.first_name) : user.telegram_id;

        // First, try to find existing row for this vehicle
        const response = await sheetsApi.spreadsheets.values.get({
            spreadsheetId,
            range: 'Vehicles!A:F'
        });

        const rows = response.data.values || [];
        let rowIndex = -1;

        // Find row with matching vehicle name and plate (skip header row)
        for (let i = 1; i < rows.length; i++) {
            if (rows[i][1] === vehicle.name && rows[i][2] === (vehicle.plate || '')) {
                rowIndex = i + 1; // 1-indexed for Sheets API
                break;
            }
        }

        const row = [
            userName,
            vehicle.name,
            vehicle.plate || '',
            '', // Service interval - now per service type, not per vehicle
            vehicle.current_odo,
            '' // Last service odo - now per service type
        ];

        if (rowIndex > 0) {
            // Update existing row
            await sheetsApi.spreadsheets.values.update({
                spreadsheetId,
                range: `Vehicles!A${rowIndex}:F${rowIndex}`,
                valueInputOption: 'RAW',
                requestBody: { values: [row] }
            });
        } else {
            // Append new row
            await sheetsApi.spreadsheets.values.append({
                spreadsheetId,
                range: 'Vehicles!A:F',
                valueInputOption: 'RAW',
                insertDataOption: 'INSERT_ROWS',
                requestBody: { values: [row] }
            });
        }
    } catch (error) {
        console.error('Error syncing vehicle to Sheets:', error.message);
    }
}

module.exports = {
    initSheets,
    syncReading,
    syncService,
    syncVehicle
};
