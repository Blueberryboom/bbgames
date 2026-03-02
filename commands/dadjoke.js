const { SlashCommandBuilder } = require('discord.js');

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
  "What do you call fake spaghetti? An impasta.",
  "Why don’t eggs tell jokes? They’d crack each other up.",
  "I used to be addicted to soap… but I’m clean now.",
  "Why did the bicycle fall over? It was two tired.",
  "What do you call cheese that isn’t yours? Nacho cheese.",
  "Why did the tomato blush? Because it saw the salad dressing.",
  "I’m reading a book about anti-gravity. It’s impossible to put down.",
  "Why did the golfer bring two pairs of pants? In case he got a hole in one.",
  "What do you call a fish wearing a bowtie? Sofishticated.",
  "I used to hate facial hair… but then it grew on me.",
  "Why can’t your nose be 12 inches long? Because then it would be a foot.",
  "What do you call a factory that makes okay products? A satisfactory.",
  "I once got fired from a canned juice company… couldn’t concentrate.",
  "Why don’t oysters donate to charity? Because they’re shellfish.",
  "I ordered a chicken and an egg online… I’ll let you know.",
  "Why did the computer go to the doctor? It caught a virus.",
  "Why don’t scientists trust atoms? Because they make up everything.",
  "I would avoid the sushi if I were you… it’s a little fishy.",
  "Why was the stadium so cool? It was filled with fans.",
  "I told my suitcase there would be no vacations this year… now I’m dealing with emotional baggage.",
  "Why did the cookie go to the hospital? It felt crummy.",
  "I used to be afraid of speed bumps… but I’m slowly getting over it.",
  "Why did the calendar get promoted? Because it had a lot of dates.",
  "What do you call a pile of cats? A meowtain.",
  "Why did the picture go to jail? It was framed.",
  "Why did the man run around his bed? To catch up on his sleep.",
  "I used to work in a shoe recycling shop… it was sole destroying.",
  "Why did the scarecrow become a successful politician? He was outstanding in his field.",
  "What do you call a sleeping bull? A bulldozer.",
  "Why don’t seagulls fly over the bay? Because then they’d be bagels.",
  "Why did the barber win the race? He took a short cut.",
  "I told my computer I needed a break… it froze.",
  "Why was the math lecture so long? The professor kept going off on a tangent.",
  "Why did the chicken join a band? Because it had drumsticks.",
  "I don’t trust those trees… they seem kind of shady.",
  "Why did the orange stop rolling? It ran out of juice.",
  "What do you call a belt made of watches? A waist of time.",
  "Why was the broom late? It swept in.",
  "I used to be a baker… but I couldn’t make enough dough.",
  "Why did the grape stop in the middle of the road? It ran out of juice.",
  "What do you call a dinosaur with an extensive vocabulary? A thesaurus."
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dadjoke')
    .setDescription('Get a random dad joke'),

  async execute(interaction) {

    const joke = jokes[Math.floor(Math.random() * jokes.length)];

    await interaction.reply(`\n${joke}`);
  }
};
