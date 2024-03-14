class BitAware {
  lsbFirst

  constructor(lsbFirst = false, flipLogic = false) {
    this.lsbFirst = lsbFirst
    this.flipLogic = flipLogic
  }

  get physical() {
    return this.calculatePhysical()
  }

  calculatePhysical() {
    let physical = this.logical
    if (this.lsbFirst)
      physical = Object.getPrototypeOf(this).constructor.bitwiseReverse(physical)
    if (this.flipLogic)
      physical = Object.getPrototypeOf(this).constructor.bitwiseFlip(physical)
    return physical
  }
}

module.exports = {
  BitAware
}
