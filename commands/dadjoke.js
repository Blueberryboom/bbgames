
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const jokes = [
  "Why don’t skeletons fight each other? They don’t have the guts.",
  "I only know 25 letters of the alphabet. I don’t know y.",
  "Why did the scarecrow win an award? Because he was outstanding in his field.",
  "I would tell you a joke about construction… but I’m still working on it.",
  "Why did the math book look sad? Because it had too many problems.",
  "I used to play piano by ear… now I use my hands.",
  "Why can’t you trust stairs? They’re always up to something.",
  "I told my wife she was drawing her eyebrows too high. She looked surprised.",
  "Why did the coffee file a police report? It got mugged.",
  "What do you call fake spaghetti? An impasta."
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dadjoke')
    .setDescription('Get a random dad joke'),

  async execute(interaction) {

    const joke = jokes[Math.floor(Math.random() * jokes.length)];

    const embed = new EmbedBuilder()
      .setTitle("Dad Joke")
      .setDescription(joke)
      .setColor(0x00AE86)
      .setFooter({ text: `Requested by ${interaction.user.username}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};2
