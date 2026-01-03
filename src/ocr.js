const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

// Create photos directory if it doesn't exist
const PHOTOS_DIR = path.join(__dirname, '..', 'data', 'photos');
if (!fs.existsSync(PHOTOS_DIR)) {
    fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

// OCR.space free API key (get your own at https://ocr.space/ocrapi)
// Free tier: 25,000 requests/month
const OCR_SPACE_API_KEY = process.env.OCR_SPACE_API_KEY || 'K85403029088957';

/**
 * Download a file from Telegram
 */
async function downloadPhoto(fileUrl, filename) {
    // Ensure directory exists
    if (!fs.existsSync(PHOTOS_DIR)) {
        fs.mkdirSync(PHOTOS_DIR, { recursive: true });
    }

    const filePath = path.join(PHOTOS_DIR, filename);

    const response = await axios({
        url: fileUrl,
        method: 'GET',
        responseType: 'arraybuffer'
    });

    fs.writeFileSync(filePath, response.data);
    return filePath;
}

/**
 * Extract numbers from OCR text
 * Focuses on finding odometer-like numbers (typically 4-7 digits)
 */
function extractOdometerValue(text) {
    console.log('📝 Raw OCR text:', text);

    // Process each line separately to avoid merging unrelated numbers
    const lines = text.split(/[\r\n]+/);
    let allCandidates = [];

    for (const line of lines) {
        // Look for decimal patterns like "28462.0" or "29.462"
        const decimalMatch = line.match(/(\d{4,6})[.,](\d)(?!\d)/);
        if (decimalMatch) {
            const value = parseInt(decimalMatch[1], 10);
            if (value >= 1000 && value <= 999999) {
                console.log('📊 Found decimal odometer:', value);
                return value;  // High confidence, return immediately
            }
        }

        // Look for thousands-separated like "29.462" (European) 
        const thousandsMatch = line.match(/(\d{1,3})[.,](\d{3})(?!\d)/);
        if (thousandsMatch) {
            const value = parseInt(thousandsMatch[1] + thousandsMatch[2], 10);
            if (value >= 1000 && value <= 999999) {
                console.log('📊 Found thousands-format:', value);
                allCandidates.push(value);
            }
        }

        // Look for plain 5-6 digit numbers (most likely odometer)
        const plainMatches = line.match(/\d{5,6}/g);
        if (plainMatches) {
            for (const m of plainMatches) {
                let value = parseInt(m, 10);
                // If ends with 0 and is 6 digits, might be decimal (284620 = 28462.0)
                if (m.length === 6 && m.endsWith('0')) {
                    value = Math.floor(value / 10);  // 284620 -> 28462
                }
                if (value >= 1000 && value <= 999999) {
                    allCandidates.push(value);
                }
            }
        }

        // Also check for 4-digit numbers
        const fourDigitMatches = line.match(/\b\d{4}\b/g);
        if (fourDigitMatches) {
            for (const m of fourDigitMatches) {
                const value = parseInt(m, 10);
                if (value >= 1000) {
                    allCandidates.push(value);
                }
            }
        }
    }

    console.log('📊 All candidates:', allCandidates);

    if (allCandidates.length > 0) {
        // Prefer 5-digit numbers (most common odometer range 10k-99k)
        const fiveDigit = allCandidates.filter(n => n >= 10000 && n <= 99999);
        if (fiveDigit.length > 0) {
            return fiveDigit[0];  // Return first 5-digit match
        }
        // Otherwise return largest reasonable value
        return Math.max(...allCandidates.filter(n => n <= 999999));
    }

    return null;
}

/**
 * Perform OCR using OCR.space API (free tier)
 */
async function recognizeOdometer(imagePath) {
    try {
        console.log(`🔍 Running OCR.space on: ${imagePath}`);

        const formData = new FormData();
        formData.append('file', fs.createReadStream(imagePath));
        formData.append('apikey', OCR_SPACE_API_KEY);
        formData.append('language', 'eng');
        formData.append('isOverlayRequired', 'false');
        formData.append('OCREngine', '2');  // Engine 2 is better for digits
        formData.append('scale', 'true');   // Scale image for better accuracy
        formData.append('isTable', 'false');

        const response = await axios.post('https://api.ocr.space/parse/image', formData, {
            headers: {
                ...formData.getHeaders(),
            },
            timeout: 30000
        });

        if (response.data.IsErroredOnProcessing) {
            console.error('OCR.space error:', response.data.ErrorMessage);
            return {
                success: false,
                error: response.data.ErrorMessage || 'OCR processing failed'
            };
        }

        const rawText = response.data.ParsedResults?.[0]?.ParsedText || '';
        console.log(`📝 OCR.space Result: ${rawText}`);

        const odometerValue = extractOdometerValue(rawText);

        if (odometerValue === null) {
            return {
                success: false,
                raw: rawText,
                error: 'Could not extract odometer value from image'
            };
        }

        return {
            success: true,
            value: odometerValue,
            raw: rawText
        };
    } catch (error) {
        console.error('OCR Error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Process a Telegram photo and extract odometer reading
 */
async function processOdometerPhoto(ctx, fileId) {
    let localPath = null;
    try {
        // Get file info from Telegram
        const file = await ctx.telegram.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

        // Generate unique filename
        const timestamp = Date.now();
        const ext = path.extname(file.file_path) || '.jpg';
        const filename = `odo_${ctx.from.id}_${timestamp}${ext}`;

        // Download the photo
        localPath = await downloadPhoto(fileUrl, filename);

        // Run OCR
        const ocrResult = await recognizeOdometer(localPath);

        // Delete the photo after OCR
        try {
            fs.unlinkSync(localPath);
            console.log(`🗑️ Deleted photo: ${localPath}`);
        } catch (e) {
            // Ignore cleanup errors
        }

        return {
            ...ocrResult,
            photoPath: null
        };
    } catch (error) {
        console.error('Photo processing error:', error);
        if (localPath) {
            try { fs.unlinkSync(localPath); } catch (e) { }
        }
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    recognizeOdometer,
    processOdometerPhoto,
    downloadPhoto,
    extractOdometerValue,
    PHOTOS_DIR
};
