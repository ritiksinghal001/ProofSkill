import { TaskRound } from '../../components/TaskRound';

export const MutationPage = () => (
  <TaskRound kind="mutation" eyebrow="Step · Mutation challenge" title="Adapt your code to a new requirement"
    intro="Describe the change you would make to the shown code, as code or pseudocode, and explain it. Nothing is executed, and a verification plan earns reasoning marks only, never credit for tests that were not run."
    sourceLabel="Current behaviour" requestLabel="Requested change" />
);
