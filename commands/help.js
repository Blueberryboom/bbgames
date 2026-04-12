const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType
} = require('discord.js');


const HELP_MODULES = {
  counting: {
    label: 'Counting',
    summary: 'Set up a counting channel, track progress, and manage resets/leaderboards.',
    commands: [
      ['/count channel', 'Set the counting channel.'],
      ['/count current', 'Show the current number.'],
      ['/count leaderboard', 'Show top counting users.'],
      ['/count set', 'Set current count value.'],
      ['/count reset', 'Reset counting progress.'],
      ['/count removechannel', 'Disable counting channel.']
    ]
  },
  giveaways: {
    label: 'Giveaways',
    summary: 'Create and manage giveaways, including role requirements and entries.',
    commands: [
      ['/giveaway start', 'Create a new giveaway.'],
      ['/giveaway reroll', 'Pick a new winner.'],
      ['/giveaway end', 'End a giveaway now.'],
      ['/giveaway list', 'List active giveaways.']
    ]
  },
  fun: {
    label: 'Fun',
    summary: 'Lightweight mini-games and random fun commands for your server.',
    commands: [
      ['/coinflip', 'Flip a coin.'],
      ['/dadjoke', 'Get a random dad joke.'],
      ['/dice', 'Roll dice with optional sides.'],
      ['/rps', 'Rock-paper-scissors challenge.'],
      ['/tictactoe', 'Start a tic-tac-toe game.']
    ]
  },
  youtube: {
    label: 'YouTube',
    summary: 'Post automatic upload notifications for selected YouTube channels.',
    commands: [
      ['/youtube add', 'Add a YouTube notification feed.'],
      ['/youtube remove', 'Remove a configured feed.'],
      ['/youtube list', 'Show all configured feeds.']
    ]
  },
  tags: {
    label: 'Tags',
    summary: 'Save reusable responses and send them quickly with slash commands.',
    commands: [
      ['/tag create', 'Create a new tag.'],
      ['/tag send', 'Send an existing tag.'],
      ['/tag edit', 'Edit a tag content/title.'],
      ['/tag delete', 'Delete a tag.'],
      ['/tags usage', 'Show top used tags.']
    ]
  },
  onewordstory: {
    label: 'One Word Story',
    summary: 'Build collaborative stories one word at a time in a dedicated channel.',
    commands: [
      ['/onewordstory channel', 'Set the story channel.'],
      ['/onewordstory delay', 'Set per-user word delay.'],
      ['/onewordstory disable', 'Disable story mode.'],
      ['/onewordstory view', 'View current story text.'],
      ['/onewordstory leaderboard', 'Show top contributors.'],
      ['/onewordstory restart', 'Restart the story.']
    ]
  },
  misc: {
    label: 'Misc',
    summary: 'General utility, moderation, ticket, and configuration commands.',
    commands: [
      ['/help', 'Open this help menu.'],
      ['/about', 'Show bot information.'],
      ['/status', 'Show bot/server status.'],
      ['/support', 'Get support links.'],
      ['/ticket', 'Ticket panel/config commands.'],
      ['/ticket add_user', 'Add a user to the current ticket.'],
      ['/ticket remove_user', 'Remove a user from the current ticket.'],
      ['/tickets', 'Ticket type/automation management.'],
      ['/logs', 'Set log channel and events.'],
      ['/config', 'Configure server bot settings.'],
      ['/minecraft status', 'Check a Minecraft server status.'],
      ['/minecraft monitor', 'Create or overwrite a Minecraft monitor setup.'],
      ['/minecraft monitor_channel_emojis', 'Set emoji prefixes for monitor channels.'],
      ['/minecraft stop_monitoring', 'Disable Minecraft monitor and delete its channels.'],
      ['/variableslowmode start', 'Enable variable slowmode for a channel.'],
      ['/auto_responder create', 'Create interactive auto responders.'],
      ['/auto_responder list', 'List configured auto responders.'],
      ['/auto_responder edit', 'Edit an auto responder reply.'],
      ['/auto_responder disable', 'Disable a responder for a duration.'],
      ['/auto_responder delete', 'Delete a configured auto responder.'],
      ['/bumping channel', 'Set your bumping channel.'],
      ['/bumping advertisement', 'Set your bumping advertisement text.'],
      ['/bumping disable', 'Disable bumping and clear data.'],
      ['/bump', 'Broadcast your server advertisement.']
    ]
  }
};

function buildCommandTable(rows) {
  const leftWidth = Math.max(...rows.map(([name]) => name.length), 7);
  const headerLeft = 'Command'.padEnd(leftWidth, ' ');
  const divider = `${'-'.repeat(leftWidth)} | ------------------------------`;
  const body = rows.map(([name, usage]) => `${name.padEnd(leftWidth, ' ')} | ${usage}`);
  return ['```', `${headerLeft} | Description`, divider, ...body, '```'].join('\n');
}

function buildWelcomeEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🧀 Welcome to BBGames')
    .setDescription(
      'BBGames is a powerful bot build to replace multiple discord bots with just a single one!\n' +
      "It is insanely customizable and isn't just for games, somehow it became a utility bot too!\n" +
      "This project began as a private custom bot for Blueberryboom's discord server, so if you could donate to support the bot's development and hosting that would help a ton! Use **/donate** to checkout the amazing perks that you can get :)\n\n" +
      '**Features**\n' +
      '• Counting — **OG**\n' +
      '• Giveaways — **OG**\n' +
      '• Variable Slowmode — **UNIQUE**\n' +
      '• Tickets — **POWERFUL**\n' +
      '• One word story — **POPULAR 🔥**\n' +
      '• Minecraft monitoring — **UNIQUE 👀**\n' +
      '• Premium bot — **7 DAY TRIAL**\n' +
      '• Bumping — **NEW**\n\n' +
      'Use the dropdown below to view feature details and commands.'
    );
}

function buildModuleEmbed(moduleData) {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`Help • ${moduleData.label}`)
    .setDescription(moduleData.summary)
    .addFields(
      { name: 'Commands', value: buildCommandTable(moduleData.commands) },
      {
        name: 'Want to support us and help update the bot more?',
        value: 'Get BBGames Premium by visiting https://buymeacoffee.com/blueberryboom'
      }
    );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show help categories and command list'),

  async execute(interaction) {
    const menuCustomId = `help_category:${interaction.id}`;
    const dropdown = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder('Select a module')
        .addOptions(
          { label: 'Counting', value: 'counting' },
          { label: 'Giveaways', value: 'giveaways' },
          { label: 'Fun', value: 'fun' },
          { label: 'YouTube', value: 'youtube' },
          { label: 'Tags', value: 'tags' },
          { label: 'One Word Story', value: 'onewordstory' },
          { label: 'Misc', value: 'misc' }
        )
    );

    await interaction.reply({ embeds: [buildWelcomeEmbed()], components: [dropdown] });

    const message = await interaction.fetchReply().catch(() => null);
    if (!message) return;

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 5 * 60 * 1000,
      filter: menuInteraction => menuInteraction.customId === menuCustomId
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
      const moduleData = HELP_MODULES[key];

      if (!moduleData) {
        await menuInteraction.reply({ content: '❌ Unknown help module.', ephemeral: true }).catch(() => null);
        return;
      }

      await menuInteraction.update({
        embeds: [buildModuleEmbed(moduleData)],
        components: [dropdown]
      }).catch(() => null);
    });

    collector.on('end', async () => {
      const disabledDropdown = new ActionRowBuilder().addComponents(
        StringSelectMenuBuilder.from(dropdown.components[0]).setDisabled(true)
      );

      await interaction.editReply({ components: [disabledDropdown] }).catch(() => null);
    });
  }
};
