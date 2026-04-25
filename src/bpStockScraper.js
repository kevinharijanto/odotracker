const axios = require('axios');
const cheerio = require('cheerio');

const URL = 'https://bp-akr.co.id/public/KetersediaanStokSPBUbp';

/**
 * Scrapes BP fuel stock specifically for Jakarta Garden City
 * @returns {Promise<Object>} The stock availability data
 */
async function scrapeBPStockJGC() {
    try {
        const response = await axios.get(URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
            }
        });

        const html = response.data;
        const $ = cheerio.load(html);

        // Get the date
        const dateText = $('.date-text').text().trim();

        // Data structure to hold our results
        const results = {
            date: dateText,
            bp92: { status: '-', update: '-' },
            bpUltimate: { status: '-', update: '-' },
            bpUltimateDiesel: { status: '-', update: '-' }
        };

        // Helper function to extract data from a specific tab
        const extractTabRow = (tabId, targetKey) => {
            const $tab = $(tabId);
            if (!$tab.length) return;

            // Find rows
            $tab.find('.stock-table tbody tr').each((i, el) => {
                const tds = $(el).find('td');
                if (tds.length === 4) {
                    const location = $(tds[0]).text().trim();
                    if (location === 'JAKARTA GARDEN CITY') {
                        const status = $(tds[2]).text().trim();
                        const update = $(tds[3]).text().trim();
                        
                        results[targetKey] = {
                            status: status || '-',
                            update: update || '-'
                        };
                        return false; // Break loop
                    }
                }
            });
        };

        extractTabRow('#tab1', 'bp92');
        extractTabRow('#tab2', 'bpUltimate');
        extractTabRow('#tab3', 'bpUltimateDiesel');

        // Find latest update time across all 3
        let latestUpdate = '-';
        ['bp92', 'bpUltimate', 'bpUltimateDiesel'].forEach(key => {
            if (results[key].update !== '-' && results[key].update > latestUpdate) {
                latestUpdate = results[key].update;
            }
        });
        results.latestUpdate = latestUpdate !== '-' ? latestUpdate : '-';

        return results;
    } catch (error) {
        console.error('Error scraping BP stock:', error.message);
        throw error;
    }
}

/**
 * Formats the scraped data into a Telegram message string
 */
function formatBPStockMessage(data) {
    if (!data) return '❌ Failed to fetch BP stock data.';

    const formatFuel = (name, fuelData) => {
        // According to instructions: 🟢 for TERSEDIA, 🔴 for KOSONG (when status is '-')
        const isTersedia = fuelData.status.toUpperCase() === 'TERSEDIA';
        const emoji = isTersedia ? '🟢' : '🔴';
        const statusText = isTersedia ? 'TERSEDIA' : 'KOSONG';
        return `${emoji} ${name}: ${statusText}`;
    };

    let msg = `⛽ *BP Stock — Jakarta Garden City*\n`;
    msg += `📅 ${data.date}\n\n`;
    msg += `${formatFuel('BP 92', data.bp92)}\n`;
    msg += `${formatFuel('BP Ultimate', data.bpUltimate)}\n`;
    msg += `${formatFuel('BP Ultimate Diesel', data.bpUltimateDiesel)}\n\n`;
    msg += `🕗 Last update: ${data.latestUpdate}`;

    return msg;
}

module.exports = {
    scrapeBPStockJGC,
    formatBPStockMessage
};
