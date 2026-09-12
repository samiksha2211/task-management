export function assignmentSms(
  task: string,
  dueDate: string
) {
  return `DRM/PRYJ: A task has been assigned to you. Task: "${task}", Due Date: ${dueDate}. Please take necessary action.`;
}

export function pendingSms(
  task: string,
  dueDate: string
) {
  return `DRM/PRYJ reminder: your Railwork task "${task}" is pending. Due date: ${dueDate}. Please take necessary action.`;
}

export function dueSms(
  task: string,
  dueDate: string,
  daysLeft: number
) {
  if (daysLeft === 0) {
    return `DRM/PRYJ reminder: your Railwork task "${task}" is due today. Due date: ${dueDate}. Please take necessary action.`;
  }

  return `DRM/PRYJ reminder: your Railwork task "${task}" is due in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Due date: ${dueDate}. Please take necessary action.`;
}

export function overdueSms(
  task: string,
  dueDate: string
) {
  return `DRM/PRYJ reminder: your Railwork task "${task}" due on ${dueDate} is overdue. Please take necessary action.`;
}