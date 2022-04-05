"use strict";

/*
 * Created with @iobroker/create-adapter v2.1.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");

// Load your modules here, e.g.:
// const fs = require("fs");

class BidirectionalCounter extends utils.Adapter {

	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: "bidirectional-counter",
		});
		this.on("ready", this.onReady.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		this.on("objectChange", this.onObjectChange.bind(this));
		// this.on("message", this.onMessage.bind(this));
		this.on("unload", this.onUnload.bind(this));

		this.subscribecounterId = "info.subscribedStatesCount";
		this.subscribecounter = 0;

		this.additionalIds = {
			consumed : ".consumed",
			delivered : ".delivered",
			total : ".total"
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
		// Reset the connection indicator during startup
		this.setState("info.connection", false, true);

		// Creates the subscribed state count
		await this.setObjectNotExistsAsync(this.subscribecounterId, {
			type: "state",
			common: {
				name: "Count of subscribed states",
				type: "number",
				role: "indicator",
				read: true,
				write: false,
				def:0
			},
			native: {},
		});

		//Read all states with custom configuration
		const customStateArray = await this.getObjectViewAsync("system","custom",{});

		// Request if there is an object
		if(customStateArray && customStateArray.rows)
		{
			for(let index = 0 ; index < customStateArray.rows.length ; index++){
				if(customStateArray.rows[index].value !== null){
					// Request if there is an object for this namespace an its enabled
					if (customStateArray.rows[index].value[this.namespace] && customStateArray.rows[index].value[this.namespace].enabled === true) {
						const id = customStateArray.rows[index].id;
						const obj = await this.getForeignObjectAsync(id);
						if(obj){
							const common = obj.common;
							const state = await this.getForeignStateAsync(id);
							if(state){
								await this.addObjectAndCreateState(id,common,customStateArray.rows[index].value[this.namespace],state,true);
							}
						}
					}
				}
			}
		}

		this.subscribeForeignObjects("*");
		this.setState(this.subscribecounterId,this.subscribecounter,true);
		this.setState("info.connection", true, true);
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
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
			callback();
		}
	}

	async addObjectAndCreateState(id,common,customInfo,state,countUpSubscibecounter)
	{
		// check if custominfo is available
		if(!customInfo){
			return;
		}
		if(common.type != "number")
		{
			this.log.error(`state ${id} is not type number, but ${common.type}`);
			return;
		}
		this.activeStates[id] = {
			lastValue: state.val,
			enableFallbackToZero: customInfo.enableFallbackToZero
		};

		// Create adapter internal object
		const tempId = this.createStatestring(id);
		await this.setObjectAsync(tempId,{
			type:"channel",
			common:{
				name: customInfo.channelName
			},
			native : {},
		});

		// create adapter internal states
		for(const myId in this.additionalIds){
			const tempId = this.createStatestring(id) + this.additionalIds[myId];
			await this.setObjectNotExistsAsync(tempId,{
				type: "state",
				common: {
					name: common.name,
					type: common.type,
					role: common.role,
					unit: common.unit,
					read: true,
					write: true,
					def: 0
				},
				native: {},
			});
			this.log.info(`state ${tempId} added / activated`);
			this.subscribeStates(tempId);
			const lastState = await this.getStateAsync(tempId);
			this.log.info(JSON.stringify(lastState));
			if(lastState !== undefined && lastState !== null){
				this.activeStatesLastAdditionalValues[this.namespace + "." + tempId] = lastState.val;
			}
			else{
				this.activeStatesLastAdditionalValues[this.namespace + "." + tempId] = 0;
			}
		}

		// Subcribe main state
		if(countUpSubscibecounter){
			this.subscribeForeignStates(id);
			this.subscribecounter += 1;
			this.setState(this.subscribecounterId,this.subscribecounter,true);
		}
	}

	createStatestring(id){
		return `counted_Values.${id.replace(/\./g, "_")}`;
	}

	// clear the state from the active array. if selected the state will be deleted
	async clearStateArrayElement(id)
	{
		// Unsubscribe and delete states if exists
		if(this.activeStates[id]){
			this.unsubscribeForeignStates(id);
			this.log.info(`state ${id} not longer subscribed`);
		}
		for(const myId in this.additionalIds){
			const tempId = this.createStatestring(id) + this.additionalIds[myId];
			const myObj = await this.getObjectAsync(tempId);
			if(myObj){
				this.unsubscribeForeignStates(tempId);
				this.log.info(`state ${tempId} removed`);
				if(this.config.deleteStatesWithDisable){
					this.delObjectAsync(tempId);
					this.log.info(`state ${this.namespace}.${tempId} deleted`);
				}
			}
		}
		// Delete channel Object
		if(this.config.deleteStatesWithDisable){
			this.delObjectAsync(this.createStatestring(id));
		}

		// delete active State in array
		if(this.activeStates[id])
		{
			delete this.activeStates[id];
			this.subscribecounter -= 1;
			this.setState(this.subscribecounterId,this.subscribecounter,true);
		}
	}

	/***************************************************************************************
	 * ********************************** Changes ******************************************
	 ***************************************************************************************/

	async onObjectChange(id, obj) {
		if (obj) {
			try {
				// Load configuration as provided in object
				const stateInfo = await this.getForeignObjectAsync(id);
				if (!stateInfo) {
					this.log.error(`Can't get information for ${id}, state will be ignored`);
					if(this.activeStates[id] != undefined)
					{
						this.clearStateArrayElement(id);
					}
					return;
				} else
				{
					if(!stateInfo.common.custom){
						if(this.activeStates[id])
						{
							this.clearStateArrayElement(id);
							return;
						}
					}
					else{
						const customInfo = stateInfo.common.custom[this.namespace];
						if(this.activeStates[id])
						{
							const state = await this.getForeignStateAsync(id);
							if(state){
								await this.addObjectAndCreateState(id,stateInfo.common,customInfo,state,false);
							}
						}
						else
						{
							const state = await this.getForeignStateAsync(id);
							if(state)
							{
								this.addObjectAndCreateState(id,stateInfo.common,customInfo,state,true);
							}
							else
							{
								this.log.error(`could not read state ${id}`);
							}
						}
					}
				}
			} catch (error) {
				this.log.error(error);
				this.clearStateArrayElement(id);
			}
		} else {
			// The object was deleted
			// Check if the object is kwnow
			const obj = await this.getObjectAsync(this.createStatestring(id) + this.additionalIds.consumed);
			if(this.activeStates[id] || obj)
			{
				this.clearStateArrayElement(id);
			}
		}
	}



	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	onStateChange(id, state) {
		if (state) {
			// Check if state.val is reachable
			if(state.val !== undefined && state.val !== null){
				// Check Changes in Foreign states
				if(this.activeStates[id]){
					if(state.val !== 0 || this.activeStates[id].enableFallbackToZero){
						const difference = Number(state.val) - this.activeStates[id].lastValue;
						if(difference >= 0){
							const tempId = this.createStatestring(id) + this.additionalIds.consumed;
							const tempValue = this.activeStatesLastAdditionalValues[this.namespace + "." + tempId] + difference;
							this.activeStatesLastAdditionalValues[this.namespace + "." + tempId] = tempValue;
							this.setStateAsync(tempId,tempValue,true);
						}
						else{
							const tempId = this.createStatestring(id) + this.additionalIds.delivered;
							const tempValue = this.activeStatesLastAdditionalValues[this.namespace + "." + tempId] - difference;
							this.activeStatesLastAdditionalValues[this.namespace + "." + tempId] = tempValue;
							this.setStateAsync(tempId,tempValue,true);
						}
						const tempId = this.createStatestring(id) + this.additionalIds.total;
						const tempValue = this.activeStatesLastAdditionalValues[this.namespace + "." + tempId] + difference;
						this.activeStatesLastAdditionalValues[this.namespace + "." + tempId] = tempValue;
						this.setStateAsync(tempId,tempValue,true);
					}
					this.activeStates[id].lastValue = state.val;
				}

				// Check Changes in interneal States
				else if(this.activeStatesLastAdditionalValues[id] !== undefined && this.activeStatesLastAdditionalValues[id] !== null && !state.ack){
					this.activeStatesLastAdditionalValues[id] = state.val;
					this.setForeignStateAsync(id,state.val,true);
				}
			}

		} else {
			// The state was deleted
			this.log.info(`state ${id} deleted`);
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
	// 			this.log.info("send command");

	// 			// Send response in callback if required
	// 			if (obj.callback) this.sendTo(obj.from, obj.command, "Message received", obj.callback);
	// 		}
	// 	}
	// }

}

if (require.main !== module) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new BidirectionalCounter(options);
} else {
	// otherwise start the instance directly
	new BidirectionalCounter();
}