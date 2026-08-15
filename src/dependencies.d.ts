declare module "mqtt-topics" {
  export function match(filter: string, topic: string): boolean;
  const MqttTopics: { match: typeof match };
  export default MqttTopics;
}
declare module "bme280";
declare module "bme680-sensor";
declare module "node-yaml";
