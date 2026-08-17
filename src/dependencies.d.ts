declare module "mqtt-topics" {
  export function match(filter: string, topic: string): boolean;
  const MqttTopics: { match: typeof match };
  export default MqttTopics;
}
declare module "bme280";
declare module "bme680-sensor";
declare module "node-yaml";
declare module "pi-spi";
declare module "inkyphat";
// Deep imports. inkyphat sets no "exports" field, so its lib/ is reachable,
// which is what lets src/outputs/inky-phat.ts inject its own Gpio through the
// controller factory and patch the BUSY-pin poller in its utils.
//
// Each is declared without a shape deliberately. Writing one here would assert
// a contract the package does not publish, and it would then drift silently the
// first time the package changed.
declare module "inkyphat/lib/inkyphat-controller.js";
declare module "inkyphat/lib/inkyphat-utils.js";
declare module "inkyphat/lib/inkyphat-renderer-v2.js";
