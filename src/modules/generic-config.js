import isEqual from 'lodash/isEqual.js'
import set from 'lodash/set.js'

import { updateReportedShadow } from '../shadow.js'
import { Stateful } from './generic-stateful.js'

import { globals } from '../index.js'

export class Config extends Stateful {
  constructor(stateKey) {
    super(stateKey)
  }

  async setState(path, value) {
    globals.logger.info({ role: 'breadcrumb', path, value }, `Updating state for ${path} to ${value}.`)
    set(this.currentState, path, value)
    return updateReportedShadow({ island: { ...this.currentState } })
  }

  // takes in the entire state tree and decomposes it to the ones relevant to this module
  async handleState({ desired, delta, reported }) {
    this.genericHandleState({
      desired, delta, reported,
      shortPath: this.stateKey,
      path: this.stateKey,
      type: this.stateKey
    })
  }

  // TODO: mostly a carbon-copy of generic-module.handleStateChange
  async handleStateChange(newState, reported) {
    this.currentState = newState

    if (!isEqual(newState, reported)) {

      // the "island" config goes at the top level, others go under config
      if (this.stateKey === 'island') {
        updateReportedShadow({ island: newState })
      } else {
        updateReportedShadow(set({}, `config[${this.stateKey}]`, newState))
      }
    }
  }
}
