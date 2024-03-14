class BitAware {
  constructor(lsbFirst = false, flipLogic = false) {
    this.initialLsbFirst = lsbFirst
    this.initialFlipLogic = flipLogic
    this.lsbFirst = lsbFirst
    this.flipLogic = flipLogic
  }

  get physical() {
    return this.calculatePhysical()
  }

  calculatePhysical() {
    let physical = this.logical
    const proto = Object.getPrototypeOf(this).constructor

    if (this.lsbFirst !== this.initialLsbFirst) {
      physical = proto.bitwiseReverse(physical).logical
    }

    if (this.flipLogic !== this.initialFlipLogic) {
      physical = proto.bitwiseFlip(physical).logical
    }

    return physical
  }
}

module.exports = {
  BitAware
}
