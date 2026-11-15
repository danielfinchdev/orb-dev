// The one rule for «this task needs the user»: it waits for approval, or Orb held its result for review.
// Every counter, badge and filter of the interface asks here instead of repeating the status test.
export const needsApproval = (task) => Boolean(task && (task.status === 'awaiting_approval' || task.held));
export const countApprovals = (tasks) => (tasks ?? []).filter(needsApproval).length;
