// minecraftMonitorManager.js

// Store channel ID in the database before updating
async function storeChannelId(channelId) {
    // Code to store channel ID in the database
}

// Update channels regardless of user modifications
async function updateChannels(channel) {
    // Code for channel updating logic
    // Ensure channel ID is stored before further actions
    await storeChannelId(channel.id);
}

// Utility function to strip old emojis from channel names
function stripOldEmojis(channelName) {
    return channelName.replace(/:[\w\d_]+:/g, ''); // Removes old emoji patterns
}

// Apply new emojis and update the channel name
async function applyNewEmojisAndUpdate(channel, newEmojis) {
    const cleanedName = stripOldEmojis(channel.name) + newEmojis;
    // Code to update the channel name with cleanedName
    await updateChannels(channel);
}