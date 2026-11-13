/**
 * Wie mag een taak aanpassen, afvinken of verwijderen?
 *
 * Collega's mogen elkaars taken bekijken, maar niet zomaar wijzigen. Een taak
 * aanpassen mag alleen als:
 * - je de eigenaar (Jarno) bent;
 * - de taak aan jou is toegewezen;
 * - jij de taak hebt aangemaakt (bijv. aan een collega gegeven);
 * - de taak nog niet is toegewezen ("Verdelen onder team").
 *
 * Eén pure functie, zodat de takenpagina (knoppen tonen) en de server-acties
 * (afdwingen) precies dezelfde regel gebruiken.
 */
export type TaskPermissionViewer = { id: string; isOwner: boolean };
export type TaskPermissionTask = { assigneeId: string | null; createdById: string | null };

export function canModifyTask(viewer: TaskPermissionViewer, task: TaskPermissionTask): boolean {
  if (viewer.isOwner) return true;
  if (!task.assigneeId) return true;
  if (task.assigneeId === viewer.id) return true;
  if (task.createdById && task.createdById === viewer.id) return true;
  return false;
}

export const TASK_READONLY_MESSAGE =
  "Dit is een taak van een collega. Je kunt hem bekijken, maar alleen de verantwoordelijke of degene die hem heeft aangemaakt kan hem aanpassen.";
