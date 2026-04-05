'use strict';
const lodash = require('lodash');

const { DeviceManagement } = require('@iobroker/dm-utils');

/**
 * DeviceManager Class
 */
class GridVisDeviceManagement extends DeviceManagement {
    /**
     * Initialize Class with Adapter
     *
     * @param adapter Adapter Reference
     */
    constructor(adapter) {
        super(adapter);
        this.adapter = adapter;
    }

    /**
     * List all devices
     *
     * @param context Context of loadDevices
     */
    async loadDevices(context) {
        context.setTotalDevices(Object.keys(this.adapter.objectStore.devices).length);
        const sortedDevices = Object.fromEntries(
            Object.entries(this.adapter.objectStore.devices).sort(([, a], [, b]) => {
                const nameA = a.object?.common?.name?.toLowerCase() || '';
                const nameB = b.object?.common?.name?.toLowerCase() || '';
                return nameA.localeCompare(nameB);
            }),
        );
        for (const [deviceId, deviceValue] of Object.entries(sortedDevices)) {
            const idetifier = this.transformId(deviceId);
            const res = {
                id: deviceId,
                identifier:
                    idetifier < 27
                        ? idetifier
                        : `${idetifier.substring(0, 13)} ... ${idetifier.substring(idetifier.length - 13)}`,
                name:
                    deviceValue.object.common.name !== undefined && deviceValue.object.common.name !== ''
                        ? deviceValue.object.common.name
                        : deviceId,
                hasDetails: true,
                backgroundColor: 'primary',
                icon: `/adapter/${this.adapter.name}/bidirectional-counter.png`,
            };
            res.customInfo = {
                id: deviceId,
                schema: {
                    type: 'panel',
                    items: {},
                },
            };
            for (const [key, value] of Object.entries(deviceValue)) {
                if (key === 'object') {
                    continue;
                }
                let lastIdPart = value.object._id.substring(value.object._id.lastIndexOf('.') + 1);
                let card = {
                    name: ` ${this.replaceNameing(lastIdPart)}`,
                };
                card = lodash.merge(card, value.object.native?.card);
                const preLabel = card.preLabel ?? '';
                let label = '';
                if (card.name) {
                    label = card.name;
                } else if (card.label) {
                    label = card.label;
                } else {
                    label = value.object._id.substring(value.object._id.lastIndexOf('.') + 1);
                }
                res.customInfo.schema.items[`_${value.object._id}`] = {
                    type: 'state',
                    oid: value.object._id,
                    foreign: true,
                    control: 'number',
                    label: preLabel + label,
                    digits: card.digits ?? 1,
                };
            }
            const items = res.customInfo.schema.items;
            // 1. Object → Array
            const sortedEntries = Object.entries(items).sort(([, a], [, b]) => {
                const aIsRohwert = a.label.includes('Rohwert');
                const bIsRohwert = b.label.includes('Rohwert');

                // 1. Always push "Rohwert" to the end
                if (aIsRohwert && !bIsRohwert) {
                    return 1;
                }
                if (!aIsRohwert && bIsRohwert) {
                    return -1;
                }

                // 2. Default alphabetical sorting
                return a.label.localeCompare(b.label, 'de');
            });

            // 2. Array → Objekt
            res.customInfo.schema.items = Object.fromEntries(sortedEntries);
            context.addDevice(res);
        }
    }

    /**
     * @param {string} id ID from device
     * @returns {Promise<import('@iobroker/dm-utils').DeviceDetails>} return the right value
     */
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    async getDeviceDetails(id) {
        // eslint-disable-next-line jsdoc/check-tag-names
        /** @type {Record<string, import('@iobroker/dm-utils').ConfigItemAny>} */
        const sourceItems = {};
        // eslint-disable-next-line jsdoc/check-tag-names
        /** @type {Record<string, import('@iobroker/dm-utils').ConfigItemAny>} */
        const deviceObjectItems = {};
        const data = {};

        sourceItems[`Header`] = {
            newLine: true,
            type: 'header',
            text: `sourceStates`,
            size: 3,
        };
        // Replace
        const usedId = this.transformId(id);
        sourceItems[`source`] = {
            newLine: true,
            type: 'state',
            control: 'number',
            label: usedId,
            oid: usedId,
            foreign: true,
        };

        // Devices Object
        deviceObjectItems['DeviceObjectHeader'] = {
            newLine: true,
            type: 'header',
            text: 'DeviceObject',
            size: 3,
        };
        deviceObjectItems['DeviceObject'] = {
            type: 'text',
            readOnly: true,
            minRows: 30,
            maxRows: 30,
        };
        data.DeviceObject = JSON.stringify(this.adapter.objectStore.devices[id], null, 2);

        // eslint-disable-next-line jsdoc/check-tag-names
        /** @type {import('@iobroker/dm-utils').JsonFormSchema} */
        const schema = {
            type: 'tabs',
            tabsStyle: {
                minWidth: 850,
            },
            items: {},
        };
        schema.items.sourceItems = {
            type: 'panel',
            label: 'sourceStates',
            items: sourceItems,
        };
        schema.items.deviceObtectItems = {
            type: 'panel',
            label: 'deviceObject',
            items: deviceObjectItems,
        };
        // return the schema
        return { id, schema, data };
    }

    /**
     *
     * @param name Name to replace
     */
    replaceNameing(name) {
        switch (name) {
            case 'consumed':
                return 'Bezogen';

            case 'delivered':
                return 'Geliefert';

            case 'total':
                return 'Total';

            case 'raw':
                return 'Rohwert';
            default:
                return name;
        }
    }

    /**
     * @param id Id totransform
     */
    transformId(id) {
        id = id.replace('_', '.');

        // --- Case 1: 0_userdata ---
        if (id.startsWith('0.userdata')) {
            id = id.replaceAll('_', '.');
            return id.replace('.', '_');
        } else if (id.startsWith(this.adapter.namespace)) {
            // Replace the first 3 '_'
            id = id.replace('_', '.');
            id = id.replace('_', '.');
            id = id.replace('_', '.');
            // Replace back 'counted_Values'
            id = id.replace('counted.Values', 'counted_Values');
            // Replace the last '_'
            let lastIndex = id.lastIndexOf('_');
            return `${id.substring(0, lastIndex)}.${id.substring(lastIndex + 1)}`;
        }
        // --- Default ---
        return id.replace(/_/g, '.');
    }
}

module.exports = GridVisDeviceManagement;
