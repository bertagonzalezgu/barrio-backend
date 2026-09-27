import { User } from '../models/User';

describe('User model', () => {
  beforeAll(async () => {
    await User.init();
  });

  it('crea un usuario válido con los campos requeridos', async () => {
    const user = await User.create({
      firebaseUid: 'uid-test-001',
      nombre: 'Ana Test',
      email: 'ana@barrio.local',
    });
    expect(user._id).toBeDefined();
    expect(user.creditos).toBe(0);
    expect(user.verificado).toBe(false);
    expect(user.rating).toBe(0);
  });

  it('falla si falta firebaseUid', async () => {
    await expect(
      User.create({ nombre: 'Ana', email: 'ana@barrio.local' })
    ).rejects.toThrow();
  });

  it('falla si se duplica el firebaseUid', async () => {
    await User.create({ firebaseUid: 'uid-dup', nombre: 'Ana', email: 'ana@barrio.local' });
    await expect(
      User.create({ firebaseUid: 'uid-dup', nombre: 'Otra', email: 'otra@barrio.local' })
    ).rejects.toThrow();
  });

  it('falla si falta email', async () => {
    await expect(
      User.create({ firebaseUid: 'uid-test-002', nombre: 'Ana' })
    ).rejects.toThrow();
  });
});