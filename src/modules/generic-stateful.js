import isEqual from 'lodash/isEqual.js'
import get from 'lodash/get.js'
import set from 'lodash/set.js'
import merge from 'lodash/merge.js'

import { globals } from '../index.js'

export class Stateful {
  constructor(stateKey) {
    // set the initial state
    this.currentState = {}
    this.stateKey = stateKey

    this.debug = (obj, msg, args) => {
      if (typeof obj === 'string') {
        msg = obj
        obj = {}
      }

      globals.logger.debug({
        ...obj,
        role: 'breadcrumb',
        virtual: this.currentState.virtual,
        tags: [...(obj.tags || []), stateKey]
      }, msg, args)
    }

    this.info = (obj, msg, args) => {
      if (typeof obj === 'string') {
        msg = obj
        obj = {}
      }

      globals.logger.info({
        ...obj,
        role: 'breadcrumb',
        virtual: this.currentState.virtual,
        tags: [...(obj.tags || []), stateKey]
      }, msg, args)
    }

    this.error = (obj, msg, args) => {
      if (typeof obj === 'string') {
        msg = obj
        obj = {}
      }

      globals.logger.error(obj, msg, args)
      /*
      globals.logger.error({
        ...obj,
        role: 'breadcrumb',
        virtual: this.currentState.virtual,
        tags: [...(obj.tags || []), stateKey]
      }, msg, args)
      */
    }
  }

  async handleDeltaState(delta) {
    this.handleState({ delta })
  }

  // TODO: mostly a carbon copy of generic-module.genericHandleState
  async genericHandleState({ desired: _desired, delta: _delta, reported: _reported, path, type, shortPath }) {
    // if (type === shortPath) {
      // globals.logger.info({ role: 'breadcrumb' }, `Received new ${_desired && _reported ? 'full' : 'partial'} state for ${shortPath}.`)
    // } else {
      // globals.logger.info({ role: 'breadcrumb' }, `Received new ${_desired && _reported ? 'full' : 'partial'} state for ${type} ${shortPath}.`)
    // }
    //
    const desired = get(_desired, path)
    const delta = get(_delta, path)
    const reported = get(_reported, path)

    let merged
    if (delta) {
      merged = merge({}, this.currentState, reported, delta)
    } else if (desired) {
      merged = merge({}, this.currentState, desired)
    } else {
      merged = merge({}, this.currentState, reported)
    }

    function logIfDefined(name, value) {
      return `${name} is currently ${value !== undefined ? 'defined:' : 'undefined.'}`
    }

    // if this branch of the state tree doesn't apply, don't continue
    if (desired === undefined && delta === undefined)
      return

    globals.logger.debug({ role: 'blob', tags: ['shadow'], state: { delta, desired, reported, currentState: this.currentState, merged }, path, shortPath }, 'Shadow state:')

    if (desired && path === 'scripts') this.init(desired)

    if (this.currentState && this.currentState.enabled === undefined && desired && desired.enabled !== undefined) {
      globals.logger.info({ role: 'breadcrumb', tags: ['shadow'] }, `${shortPath} not yet enabled or disabled. Setting ${shortPath} to ${desired.enabled ? 'enabled' : 'disabled'} to match desired state.`)
      this.init(desired)
    } else if (delta && !isEqual(this.currentState, merged)) {
      globals.logger.info({ role: 'breadcrumb', tags: ['shadow'] }, `Modifying ${shortPath} to reflect a merge of delta state and current state.`)
      globals.logger.debug({ role: 'blob', tags: ['shadow'], currentState: this.currentState }, logIfDefined('Merged state', this.currentState))
      this.handleStateChange(merged, reported)
    } else if (desired && !isEqual(desired, this.currentState)) {
      globals.logger.info({ role: 'breadcrumb', tags: ['shadow'] }, `Modifying ${shortPath} because it does not match the desired state.`)
      this.handleStateChange(desired, reported)
    } else {
      globals.logger.info({ role: 'breadcrumb', tags: ['shadow'] }, `No change to ${shortPath} necessary for this state update.`)
    }
  }

  async updateState(newState) {
    const newPaths = Object.getOwnPropertyNames(newState)

    // process all the top level keys that aren't explicitly ordered
    for (let i = 0; i < newPaths.length; i++) {
      const path = newPaths[i]
      if (!this.paths[path]) {
        this.copyState(newState, path)
      }
    }

    // then process all the top level keys with explicit order and handlers
    let promises = []
    newPaths.filter((newPath) => this.paths[newPath])
      .map((newPath) => { return { ...this.paths[newPath], path: newPath } })
      .sort((a, b) => a.order - b.order)
      .forEach((pathObj) => promises.push(pathObj.handler.bind(this)(newState, pathObj.path)))

    Promise.all(promises)
  }

  copyState(newState, path) {
    set(this.currentState, path, get(newState, path))
  }

  init() {}
}
