/**
 * Admin Panel Handlers
 * Hidden admin functionality for managing allowed users and viewing access requests
 */

const db = require('../db');

// Admin secret passphrase - change this to something only you know
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'odotracker_admin_2024';

/**
 * Register admin command handlers
 */
function registerAdminHandlers(bot) {
    // Hidden admin command - won't show in menu
    // Usage: /admin <secret> or just /admin (will prompt for secret)
    bot.command('admin', async (ctx) => {
        const args = ctx.message.text.split(' ').slice(1);
        const userId = ctx.from?.id?.toString();

        if (!userId) {
            return ctx.reply('❌ Could not identify user.');
        }

        // Check if secret is provided
        if (args.length === 0) {
            ctx.session.adminAuth = { step: 'awaiting_secret' };
            return ctx.reply(
                '🔐 *Admin Authentication*\n\nPlease enter the admin secret:',
                { parse_mode: 'Markdown' }
            );
        }

        const secret = args.join(' ');
        if (secret !== ADMIN_SECRET) {
            console.log(`⛔ Failed admin auth attempt from ${userId}`);
            return ctx.reply('❌ Invalid admin secret.');
        }

        // Check if user is an admin
        if (!isAdmin(userId)) {
            console.log(`⛔ Non-admin user ${userId} tried to access admin panel`);
            return ctx.reply('❌ You are not authorized as an admin.');
        }

        ctx.session.isAdmin = true;
        await showAdminMenu(ctx);
    });

    // Admin action handlers
    bot.action('admin_view_requests', async (ctx) => {
        if (!ctx.session?.isAdmin) {
            return ctx.answerCbQuery('❌ Not authorized');
        }
        await ctx.answerCbQuery();
        await showAccessRequests(ctx);
    });

    bot.action('admin_view_allowed', async (ctx) => {
        if (!ctx.session?.isAdmin) {
            return ctx.answerCbQuery('❌ Not authorized');
        }
        await ctx.answerCbQuery();
        await showAllowedUsers(ctx);
    });

    bot.action('admin_add_user', async (ctx) => {
        if (!ctx.session?.isAdmin) {
            return ctx.answerCbQuery('❌ Not authorized');
        }
        await ctx.answerCbQuery();
        ctx.session.adminAction = 'adding_user';
        await ctx.reply(
            '➕ *Add Allowed User*\n\nSend me the Telegram user ID to allow:',
            { parse_mode: 'Markdown' }
        );
    });

    bot.action('admin_remove_user', async (ctx) => {
        if (!ctx.session?.isAdmin) {
            return ctx.answerCbQuery('❌ Not authorized');
        }
        await ctx.answerCbQuery();
        await showRemoveUserMenu(ctx);
    });

    bot.action(/^admin_remove_(\d+)$/, async (ctx) => {
        if (!ctx.session?.isAdmin) {
            return ctx.answerCbQuery('❌ Not authorized');
        }
        const userIdToRemove = ctx.match[1];
        await ctx.answerCbQuery();

        try {
            db.removeAllowedUser(userIdToRemove);
            await ctx.reply(`✅ User ID \`${userIdToRemove}\` has been removed from allowed list.`, {
                parse_mode: 'Markdown'
            });
            await showAdminMenu(ctx);
        } catch (err) {
            await ctx.reply(`❌ Error removing user: ${err.message}`);
        }
    });

    bot.action('admin_clear_requests', async (ctx) => {
        if (!ctx.session?.isAdmin) {
            return ctx.answerCbQuery('❌ Not authorized');
        }
        await ctx.answerCbQuery();

        try {
            db.clearAccessRequests();
            await ctx.reply('✅ All access requests have been cleared.');
            await showAdminMenu(ctx);
        } catch (err) {
            await ctx.reply(`❌ Error: ${err.message}`);
        }
    });

    bot.action('admin_back', async (ctx) => {
        if (!ctx.session?.isAdmin) {
            return ctx.answerCbQuery('❌ Not authorized');
        }
        await ctx.answerCbQuery();
        await showAdminMenu(ctx);
    });

    bot.action('admin_exit', async (ctx) => {
        ctx.session.isAdmin = false;
        ctx.session.adminAction = null;
        await ctx.answerCbQuery('👋 Exited admin panel');
        await ctx.reply('👋 Exited admin panel.');
    });
}

/**
 * Handle admin text input
 */
async function handleAdminTextInput(ctx, session) {
    // Handle secret input
    if (session.adminAuth?.step === 'awaiting_secret') {
        const secret = ctx.message.text.trim();
        const userId = ctx.from?.id?.toString();

        delete session.adminAuth;

        if (secret !== ADMIN_SECRET) {
            console.log(`⛔ Failed admin auth attempt from ${userId}`);
            return ctx.reply('❌ Invalid admin secret.');
        }

        if (!isAdmin(userId)) {
            console.log(`⛔ Non-admin user ${userId} tried to access admin panel`);
            return ctx.reply('❌ You are not authorized as an admin.');
        }

        session.isAdmin = true;
        await showAdminMenu(ctx);
        return true;
    }

    // Handle adding user
    if (session.adminAction === 'adding_user' && session.isAdmin) {
        const newUserId = ctx.message.text.trim();
        session.adminAction = null;

        // Validate it's a number
        if (!/^\d+$/.test(newUserId)) {
            await ctx.reply('❌ Invalid user ID. Please enter a numeric Telegram user ID.');
            return true;
        }

        try {
            db.addAllowedUser(newUserId);
            await ctx.reply(
                `✅ User ID \`${newUserId}\` has been added to the allowed list!\n\n` +
                `They can now use the bot.`,
                { parse_mode: 'Markdown' }
            );
            await showAdminMenu(ctx);
        } catch (err) {
            await ctx.reply(`❌ Error: ${err.message}`);
        }
        return true;
    }

    return false;
}

/**
 * Show admin menu
 */
async function showAdminMenu(ctx) {
    const stats = db.getAdminStats();

    await ctx.reply(
        `🔐 *Admin Panel*\n\n` +
        `📊 *Stats:*\n` +
        `• Allowed users: ${stats.allowedUsers}\n` +
        `• Pending requests: ${stats.pendingRequests}\n` +
        `• Total bot users: ${stats.totalUsers}\n\n` +
        `What would you like to do?`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👥 View Access Requests', callback_data: 'admin_view_requests' }],
                    [{ text: '✅ View Allowed Users', callback_data: 'admin_view_allowed' }],
                    [{ text: '➕ Add User', callback_data: 'admin_add_user' }],
                    [{ text: '➖ Remove User', callback_data: 'admin_remove_user' }],
                    [{ text: '🗑️ Clear Requests', callback_data: 'admin_clear_requests' }],
                    [{ text: '🚪 Exit Admin', callback_data: 'admin_exit' }]
                ]
            }
        }
    );
}

/**
 * Show access requests
 */
async function showAccessRequests(ctx) {
    const requests = db.getAccessRequests();

    if (requests.length === 0) {
        await ctx.reply(
            '📭 *No access requests*\n\nNo one has tried to access the bot yet.',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '« Back to Admin', callback_data: 'admin_back' }]]
                }
            }
        );
        return;
    }

    let message = '👥 *Access Requests*\n\n';

    for (const req of requests) {
        const date = new Date(req.created_at).toLocaleString();
        message += `🆔 \`${req.telegram_id}\`\n`;
        message += `👤 ${req.first_name || 'Unknown'}`;
        if (req.username) message += ` (@${req.username})`;
        message += `\n📅 ${date}\n`;
        message += `📊 Attempts: ${req.attempt_count}\n\n`;
    }

    // Build buttons for quick-add
    const buttons = requests.slice(0, 5).map(req => ([{
        text: `➕ Add ${req.telegram_id}`,
        callback_data: `admin_quick_add_${req.telegram_id}`
    }]));

    buttons.push([{ text: '« Back to Admin', callback_data: 'admin_back' }]);

    await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
    });

    // Register quick-add handlers dynamically
    ctx.session.pendingQuickAdds = requests.map(r => r.telegram_id);
}

/**
 * Show allowed users
 */
async function showAllowedUsers(ctx) {
    const users = db.getAllowedUsers();

    if (users.length === 0) {
        await ctx.reply(
            '📭 *No allowed users*\n\nNo users have been added to the allow list yet.',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '« Back to Admin', callback_data: 'admin_back' }]]
                }
            }
        );
        return;
    }

    let message = '✅ *Allowed Users*\n\n';

    for (const user of users) {
        const date = new Date(user.created_at).toLocaleString();
        message += `🆔 \`${user.telegram_id}\`\n`;
        if (user.notes) message += `📝 ${user.notes}\n`;
        message += `📅 Added: ${date}\n\n`;
    }

    await ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '« Back to Admin', callback_data: 'admin_back' }]]
        }
    });
}

/**
 * Show remove user menu
 */
async function showRemoveUserMenu(ctx) {
    const users = db.getAllowedUsers();

    if (users.length === 0) {
        await ctx.reply(
            '📭 *No users to remove*',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '« Back to Admin', callback_data: 'admin_back' }]]
                }
            }
        );
        return;
    }

    const buttons = users.map(user => ([{
        text: `🗑️ ${user.telegram_id}${user.notes ? ` (${user.notes})` : ''}`,
        callback_data: `admin_remove_${user.telegram_id}`
    }]));

    buttons.push([{ text: '« Back to Admin', callback_data: 'admin_back' }]);

    await ctx.reply('➖ *Remove Allowed User*\n\nSelect a user to remove:', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
    });
}

/**
 * Check if user is an admin
 */
function isAdmin(telegramId) {
    const adminIds = process.env.ADMIN_USER_IDS?.split(',').map(id => id.trim()) || [];
    // Also check from database
    const dbAdmins = db.getAdmins();
    const allAdmins = [...adminIds, ...dbAdmins.map(a => a.telegram_id)];
    return allAdmins.includes(telegramId);
}

/**
 * Log an access request (called from index.js when unauthorized user tries to access)
 */
function logAccessRequest(telegramId, username, firstName) {
    db.logAccessRequest(telegramId, username, firstName);
}

/**
 * Register quick-add action handler
 */
function registerQuickAddHandler(bot) {
    bot.action(/^admin_quick_add_(\d+)$/, async (ctx) => {
        if (!ctx.session?.isAdmin) {
            return ctx.answerCbQuery('❌ Not authorized');
        }
        const userIdToAdd = ctx.match[1];
        await ctx.answerCbQuery();

        try {
            db.addAllowedUser(userIdToAdd);
            // Also remove from requests
            db.removeAccessRequest(userIdToAdd);
            await ctx.reply(`✅ User ID \`${userIdToAdd}\` has been added to allowed list!`, {
                parse_mode: 'Markdown'
            });
            await showAdminMenu(ctx);
        } catch (err) {
            await ctx.reply(`❌ Error: ${err.message}`);
        }
    });
}

module.exports = {
    registerAdminHandlers,
    handleAdminTextInput,
    logAccessRequest,
    registerQuickAddHandler,
    isAdmin
};
