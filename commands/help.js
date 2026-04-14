const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType
} = require('discord.js');

const HELP_FEATURES = {
  about: { label: 'About', summary: 'View bot details and project information.', commands: [['/about', 'Show bot information and links.']] },
  achievements: { label: 'Achievements', summary: 'Track and view user achievement progress.', commands: [['/achievements', 'View achievement progress and rewards.']] },
  afk: { label: 'AFK', summary: 'Set and manage your AFK status.', commands: [['/afk', 'Set or clear your AFK status.'], ['/afk_leaderboard', 'Show top AFK users.']] },
  automsg: { label: 'Auto Message', summary: 'Schedule automatic recurring messages.', commands: [['/automsg', 'Configure recurring auto messages.']] },
  autoresponder: { label: 'Auto Responder', summary: 'Create trigger-based automatic replies.', commands: [['/auto_responder create', 'Create an auto responder.'], ['/auto_responder list', 'List responders.'], ['/auto_responder edit', 'Edit responder output.'], ['/auto_responder disable', 'Disable a responder temporarily.'], ['/auto_responder delete', 'Delete a responder.']] },
  birthdays: { label: 'Birthdays', summary: 'Configure birthday tracking and announcements.', commands: [['/birthday', 'Manage birthday settings.']] },
  boosting: { label: 'Boost Messages', summary: 'Configure boost thank-you and leave messages.', commands: [['/boostmsg', 'Configure boost messages.'], ['/leave', 'Configure leave messages.'], ['/welcome', 'Configure welcome messages.']] },
  bumping: { label: 'Bumping', summary: 'Advertise your server and receive server ads from others.', commands: [['/bumping channel', 'Set bump destination channel.'], ['/bumping advertisement', 'Set ad text.'], ['/bumping disable', 'Disable bumping.'], ['/bump', 'Send your ad to other servers.']] },
  config: { label: 'Config', summary: 'Configure manager roles and system settings.', commands: [['/config', 'Open server configuration options.'], ['/logs', 'Configure logging options.']] },
  counting: { label: 'Counting', summary: 'Run counting game channels and stats.', commands: [['/count channel', 'Set counting channel.'], ['/count current', 'Show current number.'], ['/count leaderboard', 'Show leaderboard.'], ['/count reset', 'Reset counting.']] },
  fun: { label: 'Fun & Games', summary: 'Play mini-games and random fun commands.', commands: [['/coinflip', 'Flip a coin.'], ['/dadjoke', 'Get a dad joke.'], ['/dice', 'Roll dice.'], ['/rps', 'Play rock paper scissors.'], ['/tictactoe', 'Play tic tac toe.']] },
  giveaways: { label: 'Giveaways', summary: 'Run and manage giveaways.', commands: [['/giveaway start', 'Start a giveaway.'], ['/giveaway list', 'List giveaways.'], ['/giveaway reroll', 'Reroll winner.'], ['/giveaway end', 'End giveaway now.']] },
  help: { label: 'Help', summary: 'Browse all BBGames features and commands.', commands: [['/help', 'Open this help system.'], ['/support', 'Get support links.'], ['/donate', 'View premium perks.']] },
  leveling: { label: 'Leveling', summary: 'Set up leveling system and rewards.', commands: [['/leveling', 'Configure leveling.'], ['/level', 'Check level/xp.']] },
  minecraft: { label: 'Minecraft', summary: 'Check status and monitor Minecraft servers.', commands: [['/minecraft status', 'Check server status.'], ['/minecraft monitor', 'Create a live monitor.'], ['/minecraft monitor_channel_emojis', 'Set channel prefixes.'], ['/minecraft stop_monitoring', 'Stop monitoring.']] },
  miscmod: { label: 'Moderation Utilities', summary: 'Moderation and utility admin tools.', commands: [['/purge', 'Bulk delete messages.'], ['/sticky', 'Set sticky messages.'], ['/starboard', 'Configure starboard.'], ['/suggestions', 'Configure suggestions system.']] },
  onewordstory: { label: 'One Word Story', summary: 'Collaborative one-word story game.', commands: [['/onewordstory channel', 'Set story channel.'], ['/onewordstory delay', 'Set word delay.'], ['/onewordstory view', 'View current story.'], ['/onewordstory leaderboard', 'Top contributors.'], ['/onewordstory restart', 'Restart story.']] },
  owner: { label: 'Owner', summary: 'Owner-only management commands.', commands: [['/owner', 'Owner diagnostics and controls.']] },
  premium: { label: 'Premium', summary: 'Premium tiers and management.', commands: [['/premium', 'View/manage premium status.']] },
  say: { label: 'Say', summary: 'Send custom bot messages.', commands: [['/say', 'Send a custom bot message.']] },
  servertag: { label: 'Server Tag', summary: 'Manage custom server tags and rewards.', commands: [['/servertag', 'Configure server tag system.']] },
  status: { label: 'Status', summary: 'Show bot/service status.', commands: [['/status', 'Show status details.']] },
  suggestions: { label: 'Suggestions', summary: 'Suggestion channels and vote workflows.', commands: [['/suggest', 'Create suggestion.'], ['/suggestions', 'Manage suggestion system.']] },
  tags: { label: 'Tags', summary: 'Reusable server snippets via slash commands.', commands: [['/tag create', 'Create a tag.'], ['/tag send', 'Send a tag.'], ['/tag edit', 'Edit a tag.'], ['/tag delete', 'Delete a tag.'], ['/tags usage', 'View tag usage stats.']] },
  tickets: { label: 'Tickets', summary: 'Ticket panel and support workflows.', commands: [['/ticket', 'Open or manage tickets.'], ['/tickets', 'Configure ticket types and automations.']] },
  variableslowmode: { label: 'Variable Slowmode', summary: 'Adaptive slowmode based on activity.', commands: [['/variableslowmode start', 'Enable adaptive slowmode.'], ['/variableslowmode stop', 'Disable adaptive slowmode.']] },
  youtube: { label: 'YouTube', summary: 'Publish upload notifications automatically.', commands: [['/youtube add', 'Add channel feed.'], ['/youtube remove', 'Remove feed.'], ['/youtube list', 'List feeds.']] }
};

function buildCommandTable(rows) {
  const leftWidth = Math.max(...rows.map(([name]) => name.length), 7);
  const headerLeft = 'Command'.padEnd(leftWidth, ' ');
  const divider = `${'-'.repeat(leftWidth)} | ------------------------------`;
  const body = rows.map(([name, usage]) => `${name.padEnd(leftWidth, ' ')} | ${usage}`);
  return ['```', `${headerLeft} | Description`, divider, ...body, '```'].join('\n');
}

function buildWelcomeEmbed() {
  const featureLines = Object.values(HELP_FEATURES)
    .map(feature => `• ${feature.label}`)
    .join('\n');

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🧀 Welcome to BBGames')
    .setDescription(
      `BBGames is a powerful bot build to replace multiple discord bots with just a single one!
It is insanely customizable and isn't just for games, somehow it became a utility bot too!
This project began as a private custom bot for Blueberryboom's discord server, so if you could donate to support the bot's development and hosting that would help a ton! Use **/donate** to checkout the amazing perks that you can get :).\n\n` +
      '**All Features**\n' +
      `${featureLines}\n\n` +
      'Use the dropdown menus below to view detailed commands for every feature.'
    );
}

function buildFeatureEmbed(feature) {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`Help • ${feature.label}`)
    .setDescription(feature.summary)
    .addFields(
      { name: 'Commands', value: buildCommandTable(feature.commands) },
      {
        name: 'Support BBGames',
        value: 'Get BBGames Premium: https://buymeacoffee.com/blueberryboom'
      }
    );
}

function buildDropdownRows(interactionId) {
  const options = Object.entries(HELP_FEATURES).map(([value, feature]) => ({
    label: feature.label.slice(0, 100),
    value
  }));

  const rows = [];
  for (let index = 0; index < options.length; index += 25) {
    const chunk = options.slice(index, index + 25);
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`help_feature:${interactionId}:${Math.floor(index / 25)}`)
          .setPlaceholder('Select a feature')
          .addOptions(chunk)
      )
    );
  }

  return rows;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show help categories and command list'),

  async execute(interaction) {
    const rows = buildDropdownRows(interaction.id);
    await interaction.reply({ embeds: [buildWelcomeEmbed()], components: rows });

    const message = await interaction.fetchReply().catch(() => null);
    if (!message) return;

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 5 * 60 * 1000,
      filter: menuInteraction => menuInteraction.customId.startsWith(`help_feature:${interaction.id}:`)
    });

    collector.on('collect', async menuInteraction => {
      if (menuInteraction.user.id !== interaction.user.id) {
        await menuInteraction.reply({
          content: '❌ Only the user who ran `/help` can use this dropdown.',
          ephemeral: true
        }).catch(() => null);
        return;
      }

      const key = menuInteraction.values[0];
      const feature = HELP_FEATURES[key];

      if (!feature) {
        await menuInteraction.reply({ content: '❌ Unknown help feature.', ephemeral: true }).catch(() => null);
        return;
      }

      await menuInteraction.update({
        embeds: [buildFeatureEmbed(feature)],
        components: rows
      }).catch(() => null);
    });

    collector.on('end', async () => {
      const disabledRows = rows.map(row => new ActionRowBuilder().addComponents(
        StringSelectMenuBuilder.from(row.components[0]).setDisabled(true)
      ));

      await interaction.editReply({ components: disabledRows }).catch(() => null);
    });
  }
};
