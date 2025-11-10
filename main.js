'use strict';

/*
 * Created with @iobroker/create-adapter v2.1.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load your modules here, e.g.:
// const fs = require("fs");

class BidirectionalCounter extends utils.Adapter {
    /**
     * @param [options] options of the adapter
     */
    constructor(options) {
        super({
            ...options,
            name: 'bidirectional-counter',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('objectChange', this.onObjectChange.bind(this));
        // this.on("message", this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));

        this.subscribecounterId = 'info.subscribedStatesCount';
        this.subscribecounter = 0;

        this.additionalIds = {
            consumed: '.consumed',
            delivered: '.delivered',
            total: '.total',
            raw: '.raw',
        };

        // define arrays for selected states and calculation
        this.activeStates = {};
        this.activeStatesLastAdditionalValues = {};
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here

        //Read all states with custom configuration
        const customStateArray = await this.getObjectViewAsync('system', 'custom', {});

        // Request if there is an object
        if (customStateArray && customStateArray.rows) {
            for (let index = 0; index < customStateArray.rows.length; index++) {
                if (customStateArray.rows[index].value !== null) {
                    // Request if there is an object for this namespace an its enabled
                    if (
                        customStateArray.rows[index].value[this.namespace] &&
                        customStateArray.rows[index].value[this.namespace].enabled === true
                    ) {
                        const id = customStateArray.rows[index].id;
                        const obj = await this.getForeignObjectAsync(id);
                        if (obj) {
                            const common = obj.common;
                            const state = await this.getForeignStateAsync(id);
                            if (state) {
                                await this.addObjectAndCreateState(
                                    id,
                                    common,
                                    customStateArray.rows[index].value[this.namespace],
                                    state,
                                    true,
                                );
                            }
                        }
                    }
                }
            }
        }

        this.subscribeForeignObjects('*');
        this.setState(this.subscribecounterId, this.subscribecounter, true);
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback function wich is called after shutdown adapter
     */
    onUnload(callback) {
        try {
            // Here you must clear all timeouts or intervals that may still be active
            // clearTimeout(timeout1);
            // clearTimeout(timeout2);
            // ...
            // clearInterval(interval1);

            callback();
        } catch (e) {
            this.log.error(e);
            callback();
        }
    }

    // Creats a state with the given id
    async addObjectAndCreateState(id, common, customInfo, state, countUpSubscibecounter) {
        // check if custominfo is available
        if (!customInfo) {
            return;
        }
        if (common.type != 'number') {
            this.log.error(`state ${id} is not type number, but ${common.type}`);
            return;
        }
        this.activeStates[id] = {
            lastValue: state.val,
            valueBeforeZero: undefined,
            enableFallbackToZero: customInfo.enableFallbackToZero,
            logFallbackAsWarning: customInfo.logFallbackAsWarning,
        };

        // Create adapter internal object
        const tempId = this.createStatestring(id);
        await this.setObjectAsync(tempId, {
            type: 'channel',
            common: {
                name: customInfo.channelName,
            },
            native: {},
        });

        // create adapter internal states
        for (const myId in this.additionalIds) {
            const tempId = this.createStatestring(id) + this.additionalIds[myId];
            await this.setObjectNotExistsAsync(tempId, {
                type: 'state',
                common: {
                    name: common.name,
                    type: 'number',
                    role: common.role,
                    unit: common.unit,
                    read: true,
                    write: true,
                    def: 0,
                },
                native: {},
            });
            this.log.debug(`state ${tempId} added / activated`);
            this.subscribeStates(tempId);
            const lastState = await this.getStateAsync(tempId);
            if (lastState !== undefined && lastState !== null) {
                this.activeStatesLastAdditionalValues[`${this.namespace}.${tempId}`] = lastState.val;
            } else {
                this.activeStatesLastAdditionalValues[`${this.namespace}.${tempId}`] = 0;
            }
            this.setState(tempId, this.activeStatesLastAdditionalValues[`${this.namespace}.${tempId}`], true);
        }

        // Subcribe main state
        if (countUpSubscibecounter) {
            this.subscribeForeignStates(id);
            this.subscribecounter += 1;
            this.setState(this.subscribecounterId, this.subscribecounter, true);
        }
    }

    createStatestring(id) {
        return `counted_Values.${id.replace(/\./g, '_')}`;
    }

    // clear the state from the active array. if selected the state will be deleted
    async clearStateArrayElement(id, deleteState) {
        // Unsubscribe and delete states if exists
        if (this.activeStates[id]) {
            delete this.activeStates[id];
            this.subscribecounter -= 1;
            this.setState(this.subscribecounterId, this.subscribecounter, true);
            if (!this.activeStatesLastAdditionalValues[id]) {
                // Dont unsubscribe in case of is additional value
                this.unsubscribeForeignStates(id);
                this.log.debug(`state ${id} not longer subscribed`);
            } else {
                this.log.debug(`state ${id} not longer subscribed as active state, but still as additional`);
            }
        }
        if (this.config.deleteStatesWithDisable || deleteState) {
            for (const myId in this.additionalIds) {
                const tempId = this.createStatestring(id) + this.additionalIds[myId];
                const myObj = await this.getObjectAsync(tempId);
                if (myObj) {
                    this.unsubscribeStates(tempId);
                    this.log.debug(`state ${tempId} removed`);
                    this.delObjectAsync(tempId);
                    this.log.debug(`state ${this.namespace}.${tempId} deleted`);
                }
            }
            // Delete channel Object
            this.delObjectAsync(this.createStatestring(id));
        }
    }

    /***************************************************************************************
     * ********************************** Changes ******************************************
     ***************************************************************************************/

    async onObjectChange(id, obj) {
        if (obj) {
            try {
                if (!obj.common.custom || !obj.common.custom[this.namespace]) {
                    if (this.activeStates[id]) {
                        this.clearStateArrayElement(id, false);
                        return;
                    }
                } else {
                    const customInfo = obj.common.custom[this.namespace];
                    if (this.activeStates[id]) {
                        const state = await this.getForeignStateAsync(id);
                        if (state) {
                            await this.addObjectAndCreateState(id, obj.common, customInfo, state, false);
                        }
                    } else {
                        const state = await this.getForeignStateAsync(id);
                        if (state) {
                            this.addObjectAndCreateState(id, obj.common, customInfo, state, true);
                        } else {
                            this.log.error(`could not read state ${id}`);
                        }
                    }
                }
            } catch (error) {
                this.log.error(error);
                this.clearStateArrayElement(id, false);
            }
        } else {
            // The object was deleted
            // Check if the object is kwnow
            const obj = await this.getObjectAsync(this.createStatestring(id) + this.additionalIds.consumed);
            if (this.activeStates[id] || obj) {
                this.clearStateArrayElement(id, true);
            }
        }
    }

    /**
     * Is called if a subscribed state changes
     *
     * @param id id of the changed state
     * @param state state (val & ack) of the changed state-id
     */
    onStateChange(id, state) {
        if (state) {
            // Check if state.val is reachable
            if (state.val !== undefined && state.val !== null) {
                // Check Changes in Foreign states
                if (this.activeStates[id]) {
                    if (state.val !== 0 || this.activeStates[id].enableFallbackToZero) {
                        // Build difference
                        let difference = Number(state.val) - this.activeStates[id].lastValue;
                        // check wether the difference is smaler from the value before zero, or to zero.
                        if (this.activeStates[id].valueBeforeZero !== undefined) {
                            const differenceToValueBeforeZero =
                                Number(state.val) - this.activeStates[id].valueBeforeZero;
                            this.activeStates[id].valueBeforeZero = undefined;
                            if (Math.abs(differenceToValueBeforeZero) < Math.abs(difference)) {
                                difference = differenceToValueBeforeZero;
                            }
                            if (this.activeStates[id].logFallbackAsWarning) {
                                this.log.warn(`the id: ${id} returns from zero with value ${Number(state.val)}`);
                            } else {
                                this.log.debug(`the id: ${id} returns from zero with value ${Number(state.val)}`);
                            }
                        }
                        this.log.debug(
                            `${id} changed from ${this.activeStates[id].lastValue} to ${Number(state.val)} - Difference: ${difference}`,
                        );
                        if (difference >= 0) {
                            const tempId = this.createStatestring(id) + this.additionalIds.consumed;
                            const tempValue =
                                this.activeStatesLastAdditionalValues[`${this.namespace}.${tempId}`] + difference;
                            this.activeStatesLastAdditionalValues[`${this.namespace}.${tempId}`] = tempValue;
                            this.setState(tempId, tempValue, true);
                            this.log.debug(`${tempId} is set to ${tempValue}`);
                        } else {
                            const tempId = this.createStatestring(id) + this.additionalIds.delivered;
                            const tempValue =
                                this.activeStatesLastAdditionalValues[`${this.namespace}.${tempId}`] - difference;
                            this.activeStatesLastAdditionalValues[`${this.namespace}.${tempId}`] = tempValue;
                            this.setState(tempId, tempValue, true);
                            this.log.debug(`${tempId} is set to ${tempValue}`);
                        }
                        const tempId = this.createStatestring(id) + this.additionalIds.total;
                        const tempValue =
                            this.activeStatesLastAdditionalValues[`${this.namespace}.${tempId}`] + difference;
                        this.activeStatesLastAdditionalValues[`${this.namespace}.${tempId}`] = tempValue;
                        this.setState(tempId, tempValue, true);
                        this.log.debug(`${tempId} is set to ${tempValue}`);
                    } else if (this.activeStates[id].valueBeforeZero === undefined) {
                        this.activeStates[id].valueBeforeZero = this.activeStates[id].lastValue;
                        if (this.activeStates[id].logFallbackAsWarning) {
                            this.log.warn(`the id: ${id} is fallback to zero`);
                        } else {
                            this.log.debug(`the id: ${id} is fallback to zero`);
                        }
                    }
                    const tempId = this.createStatestring(id) + this.additionalIds.raw;
                    this.setState(tempId, state.val, true);
                    this.activeStates[id].lastValue = state.val;
                }

                // Check Changes in internal States (also if id is active state)
                if (
                    this.activeStatesLastAdditionalValues[id] !== undefined &&
                    this.activeStatesLastAdditionalValues[id] !== null &&
                    !state.ack
                ) {
                    this.activeStatesLastAdditionalValues[id] = state.val;
                    this.setStateAsync(id, state.val, true);
                }
            }
        } else {
            // The state was deleted
            this.log.debug(`state ${id} deleted`);
        }
    }

    // If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
    // /**
    //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
    //  * Using this method requires "common.messagebox" property to be set to true in io-package.json
    //  * @param {ioBroker.Message} obj
    //  */
    // onMessage(obj) {
    // 	if (typeof obj === "object" && obj.message) {
    // 		if (obj.command === "send") {
    // 			// e.g. send email or pushover or whatever
    // 			this.log.debug("send command");

    // 			// Send response in callback if required
    // 			if (obj.callback) this.sendTo(obj.from, obj.command, "Message received", obj.callback);
    // 		}
    // 	}
    // }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param [options] options of the adapter
     */
    module.exports = options => new BidirectionalCounter(options);
} else {
    // otherwise start the instance directly
    new BidirectionalCounter();
}
