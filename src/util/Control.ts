import Step, { StepConfig } from "./Step.js";

export interface ControlConfig extends StepConfig {}

// A step that decides what the chain does next rather than changing the
// message on its way through: where a transform answers "what is the message
// now", a control answers "where does it go from here".
//
// The base class adds nothing of its own. It exists so that a control is a
// kind rather than a transform that has to declare it targets nothing and
// then carry a transformSingle nothing calls.
export default abstract class Control extends Step {
  declare config: ControlConfig;
}
