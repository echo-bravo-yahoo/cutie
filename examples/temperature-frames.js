// Renders the current temperature into a bitmap for each panel, replacing the
// drawing that used to live inside the display outputs. Run by
// transform:javascript, so the only thing in scope is `message`, and the value
// of the last expression is the message that goes on to the next step.
(function () {
  var MIN = 60;
  var MAX = 95;

  var INKY_WIDTH = 212;
  var INKY_HEIGHT = 104;
  var INKY_WHITE = 0;
  var INKY_THIRD = 2;

  var UNICORN_COLS = 17;
  var UNICORN_ROWS = 7;
  var LOW = [0, 0, 255];
  var HIGH = [255, 0, 0];

  var value = Number(message.temp);
  var fraction = isFinite(value)
    ? Math.min(1, Math.max(0, (value - MIN) / (MAX - MIN)))
    : 0;

  // A horizontal bar in the panel's third colour, filled left to right.
  var filled = Math.round(fraction * INKY_WIDTH);
  var inky = new Array(INKY_WIDTH * INKY_HEIGHT);
  for (var y = 0; y < INKY_HEIGHT; y += 1) {
    for (var x = 0; x < INKY_WIDTH; x += 1) {
      inky[y * INKY_WIDTH + x] = x < filled ? INKY_THIRD : INKY_WHITE;
    }
  }

  // A gauge: columns lit left to right, their colour interpolated from blue at
  // the bottom of the range to red at the top.
  var lit = Math.round(fraction * UNICORN_COLS);
  var colour = [0, 1, 2].map(function (channel) {
    return Math.round(LOW[channel] + (HIGH[channel] - LOW[channel]) * fraction);
  });
  var unicorn = new Array(UNICORN_COLS * UNICORN_ROWS * 3);
  for (var row = 0; row < UNICORN_ROWS; row += 1) {
    for (var col = 0; col < UNICORN_COLS; col += 1) {
      var at = (row * UNICORN_COLS + col) * 3;
      unicorn[at] = col < lit ? colour[0] : 0;
      unicorn[at + 1] = col < lit ? colour[1] : 0;
      unicorn[at + 2] = col < lit ? colour[2] : 0;
    }
  }

  message.inkyFrame = inky;
  message.unicornFrame = unicorn;

  return message;
})();
