export function generateTopics(THING_NAME) {
  return {
    SHADOW_UPDATE_TOPIC: "$aws/things/" + THING_NAME + "/shadow/update",
    SHADOW_UPDATE_ACCEPTED_TOPIC: "$aws/things/" + THING_NAME + "/shadow/update/accepted",
    SHADOW_UPDATE_REJECTED_TOPIC: "$aws/things/" + THING_NAME + "/shadow/update/rejected",
    SHADOW_UPDATE_DELTA_TOPIC: "$aws/things/" + THING_NAME + "/shadow/update/delta",
    SHADOW_GET_TOPIC: "$aws/things/" + THING_NAME + "/shadow/get",
    SHADOW_GET_ACCEPTED_TOPIC: "$aws/things/" + THING_NAME + "/shadow/get/accepted",
    SHADOW_GET_REJECTED_TOPIC: "$aws/things/" + THING_NAME + "/shadow/get/rejected"
  }
}
