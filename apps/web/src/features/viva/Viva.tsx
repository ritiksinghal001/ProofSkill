import { TaskRound } from '../../components/TaskRound';

export const VivaPage = () => (
  <TaskRound kind="viva" eyebrow="Step · Project viva" title="Explain how your code works"
    intro="Each question is shown beside the exact source it was written from. Explain in your own words. We assess correctness, data flow, reasoning and failure cases, not writing style or length."
    sourceLabel="Your code" requestLabel="Question" />
);
