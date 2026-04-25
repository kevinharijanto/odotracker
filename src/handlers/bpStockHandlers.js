const db = require('../db');
const { scrapeBPStockJGC, formatBPStockMessage } = require('../bpStockScraper');

function registerBpStockHandlers(bot) {
    // /bpstock - Check current stock
    bot.command('bpstock', async (ctx) => {
        try {
            // Send typing indicator since scraping might take a second
            await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
            
            const data = await scrapeBPStockJGC();
            const message = formatBPStockMessage(data);
            
            await ctx.reply(message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('BP Stock command error:', error);
            await ctx.reply('❌ Sorry, failed to fetch BP stock data right now. Please try again later.');
        }
    });

    // /bpstockon - Enable daily 8 AM notification
    bot.command('bpstockon', async (ctx) => {
        try {
            const user = db.getOrCreateUser(
                ctx.from.id.toString(),
                ctx.from.username,
                ctx.from.first_name
            );
            
            db.setBpStockNotify(user.id, true);
            
            await ctx.reply('✅ *Daily BP Stock Notification Enabled*\n\nI will send you the Jakarta Garden City BP stock update every day at 8:00 AM.', { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('BP Stock ON error:', error);
            await ctx.reply('❌ Failed to enable notification. Please try again.');
        }
    });

    // /bpstockoff - Disable daily 8 AM notification
    bot.command('bpstockoff', async (ctx) => {
        try {
            const user = db.getOrCreateUser(
                ctx.from.id.toString(),
                ctx.from.username,
                ctx.from.first_name
            );
            
            db.setBpStockNotify(user.id, false);
            
            await ctx.reply('🔕 *Daily BP Stock Notification Disabled*\n\nYou will no longer receive daily stock updates.', { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('BP Stock OFF error:', error);
            await ctx.reply('❌ Failed to disable notification. Please try again.');
        }
    });
}

module.exports = {
    registerBpStockHandlers
};
