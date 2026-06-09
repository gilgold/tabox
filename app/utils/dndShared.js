// Single source of truth for drag-and-drop interaction tuning so every
// DndContext (sidebar folders, collection cards, detail-panel tabs) feels identical.
export const DND_ACTIVATION_DISTANCE = 5;

export const dndPointerSensorOptions = Object.freeze({
    activationConstraint: Object.freeze({ distance: DND_ACTIVATION_DISTANCE }),
});
