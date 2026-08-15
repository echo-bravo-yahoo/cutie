declare module "mqtt-topics" {
  export function match(filter: string, topic: string): boolean;
  const MqttTopics: { match: typeof match };
  export default MqttTopics;
}
declare module "bme280";
declare module "bme680-sensor";
declare module "node-yaml";
declare module "unicorn-hat-mini";
declare module "inkyphat";
// Deep import. inkyphat sets no "exports" field, so its lib/ is reachable, and
// the controller factory is the only place its Gpio implementation can be
// injected - see src/outputs/inky-phat.ts for why that matters.
declare module "inkyphat/lib/inkyphat-controller.js";
