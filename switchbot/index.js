// Load the node-switchbot and get a `Switchbot` constructor object
const Switchbot = require('node-switchbot');
// Create an `Switchbot` object
const switchbot = new Switchbot();

/*
(async () => {
  // Start to monitor advertisement packets
  await switchbot.startScan();
  // Set an event hander
  switchbot.onadvertisement = (ad) => {
    console.log(JSON.stringify(ad, null, '  '));
  };
  // Wait 10 seconds
  await switchbot.wait(10000);
  // Stop to monitor
  switchbot.stopScan();
  process.exit();
})();
*/

(async () => {
  // Find a Bot (WoHand)
  const bot_list = await switchbot.discover({ model: "H", quick: true });
  if (bot_list.length === 0) {
    throw new Error("No device was found.");
  }
  // The `SwitchbotDeviceWoHand` object representing the found Bot.
  let device = bot_list[0];
  // Put the Bot's arm down (stretch the arm)
  await device.down();
  // Wait for 5 seconds
  await switchbot.wait(5000);
  // Put the Bot's arm up (retract the arm)
  await device.up();
  process.exit();
})();
