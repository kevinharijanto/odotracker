# OdoTracker - Telegram Bot

A Telegram bot for tracking vehicle odometer readings and service schedules, with OCR capabilities and Google Sheets integration.

## Features

- 📷 **Photo OCR** - Send a photo of your odometer, the bot reads it automatically
- 🚗 **Multi-vehicle support** - Track multiple vehicles per user
- 👨‍👩‍👧‍👦 **Multi-user** - Support for family members (up to 5 users)
- 🔧 **Service tracking** - Log any type of service (oil change, tire rotation, etc.)
- ⏰ **Custom reminders** - Set your own daily reminder time
- 📊 **Google Sheets sync** - Automatic backup to Google Sheets
- 🐳 **Docker ready** - Easy deployment on home servers

## Quick Start

### 1. Create a Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the bot token

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set:
- `TELEGRAM_BOT_TOKEN` - Your bot token from BotFather
- `ALLOWED_USER_IDS` - Comma-separated Telegram user IDs for your family

To get your Telegram user ID, message [@userinfobot](https://t.me/userinfobot).

### 3. Install & Run

**Local development:**
```bash
npm install
npm run dev
```

**Production with Docker:**
```bash
docker-compose up -d
```

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and quick start guide |
| `/help` | Show all commands |
| `/addvehicle` | Add a new vehicle to track |
| `/vehicles` | List all your vehicles |
| `/editvehicle` | Edit vehicle details |
| `/removevehicle` | Remove a vehicle |
| `/logodo` | Manually log odometer reading |
| `/history` | View odometer history |
| `/service` | Record a service event |
| `/servicehistory` | View service history |
| `/status` | Check service status for all vehicles |
| `/reminder` | Set daily reminder time |
| `/settings` | View your settings |

**📷 Photo:** Just send a photo of your odometer - the bot will OCR it automatically!

## Google Sheets Integration (Optional)

1. Create a Google Cloud project
2. Enable the Google Sheets API
3. Create a Service Account and download credentials as `credentials.json`
4. Create a Google Sheet and share it with the service account email
5. Add the spreadsheet ID to `.env`

The bot will automatically create sheets for:
- **Readings** - All odometer readings
- **Services** - All service events
- **Vehicles** - Vehicle list

## Project Structure

```
├── src/
│   ├── index.js          # Main entry point
│   ├── db.js             # Database operations
│   ├── sheets.js         # Google Sheets sync
│   ├── ocr.js            # Tesseract OCR
│   ├── scheduler.js      # Daily reminders
│   └── handlers/
│       ├── vehicleHandlers.js
│       ├── odometerHandlers.js
│       ├── serviceHandlers.js
│       └── statusHandlers.js
├── data/                  # Database and photos (auto-created)
├── schema.sql            # Database schema
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## License

MIT
