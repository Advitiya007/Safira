import User from '../models/User.js';
import Guardian from '../models/Guardian.js';
import {
    decryptContact,
    encryptContact,
    hashContact,
    isEncryptedContact,
    validateContactEncryptionKey,
} from './contactEncryptionService.js';

const migrateUser = async (user) => {
    const update = {};
    for (const field of ['phone', 'emergencyContactPhone']) {
        const value = user[field];
        if (typeof value !== 'string') continue;
        if (!value) {
            if (field === 'phone') throw new Error(`User ${user._id} has an empty phone value`);
            continue;
        }
        if (isEncryptedContact(value)) decryptContact(value);
        else update[field] = encryptContact(value);
    }
    update.contactEncryptionVersion = 1;
    const result = await User.updateOne(
        { _id: user._id, contactEncryptionVersion: { $ne: 1 } },
        { $set: update },
    );
    return result.modifiedCount;
};

const migrateGuardian = async (guardian) => {
    const value = guardian.guardianPhone;
    if (typeof value !== 'string' || !value) {
        throw new Error(`Guardian ${guardian._id} has no contact number`);
    }

    const plaintext = decryptContact(value);
    const update = {
        guardianPhoneHash: hashContact(plaintext),
        contactEncryptionVersion: 1,
    };
    if (!isEncryptedContact(value)) update.guardianPhone = encryptContact(value);
    const result = await Guardian.updateOne(
        { _id: guardian._id, contactEncryptionVersion: { $ne: 1 } },
        { $set: update },
    );
    return result.modifiedCount;
};

export const migrateStoredContactNumbers = async () => {
    validateContactEncryptionKey();
    let usersUpdated = 0;
    let guardiansUpdated = 0;

    const userCursor = User.find({ contactEncryptionVersion: { $ne: 1 } })
        .select('phone emergencyContactPhone contactEncryptionVersion')
        .lean()
        .cursor();
    for await (const user of userCursor) {
        usersUpdated += await migrateUser(user);
    }

    const guardianCursor = Guardian.find({ contactEncryptionVersion: { $ne: 1 } })
        .select('guardianPhone guardianPhoneHash contactEncryptionVersion')
        .lean()
        .cursor();
    for await (const guardian of guardianCursor) {
        guardiansUpdated += await migrateGuardian(guardian);
    }

    return { usersUpdated, guardiansUpdated };
};
