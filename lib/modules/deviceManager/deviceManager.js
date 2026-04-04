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
        for (const [deviceId, deviceValue] of Object.entries(this.adapter.objectStore.devices)) {
            const res = {
                id: deviceId,
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
        // Ersetzen der id '_' gegenn '.'
        const usedId = id.startsWith('0_userdata')
            ? id.replace('_', '§').replace(/_/g, '.').replace('§', '_')
            : id.replace(/_/g, '.');

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
}

module.exports = GridVisDeviceManagement;
