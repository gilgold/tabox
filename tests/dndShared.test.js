import { DND_ACTIVATION_DISTANCE, dndPointerSensorOptions } from '../app/utils/dndShared';

describe('dndShared', () => {
    test('exposes a single activation distance used by all drag contexts', () => {
        expect(DND_ACTIVATION_DISTANCE).toBe(5);
    });

    test('pointer sensor options use the shared activation distance', () => {
        expect(dndPointerSensorOptions).toEqual({
            activationConstraint: { distance: 5 },
        });
    });
});
