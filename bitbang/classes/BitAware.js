class BitAware {
  lsbFirst

  constructor(lsbFirst = false, flipLogic = false) {
    this.initialLsbFirst = lsbFirst
    this.initialFlipLogic = flipLogic
  }

  get physical() {
    return this.calculatePhysical()
  }

  calculatePhysical() {
    let physical = this.logical
    if (this.lsbFirst !== this.initialLsbFirst)
      physical = Object.getPrototypeOf(this).constructor.bitwiseReverse(physical)
    if (this.flipLogic !== this.initialFlipLogic)
      physical = Object.getPrototypeOf(this).constructor.bitwiseFlip(physical)
    return physical
  }
}

module.exports = {
  BitAware
}
