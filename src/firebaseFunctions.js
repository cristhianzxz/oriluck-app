import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase';

// Asegúrate de que la región coincida con la de tus Cloud Functions
const functions = getFunctions(app, 'southamerica-east1');

/**
 * Llama a la función de Firebase para comprar fichas de tragamonedas.
 * Esta es una operación segura que se ejecuta en el servidor.
 * @param {{chipsToBuy: number}} data - Objeto con la cantidad de fichas a comprar.
 * @returns {Promise<any>} El resultado de la llamada a la función, que incluye el nuevo estado de las fichas y el saldo.
 */
export const buySlotsChips = httpsCallable(functions, 'buySlotsChipsCallable');

/**
 * Llama a la función de Firebase para ejecutar un giro en la tragamonedas.
 * El motor legal (RNG y tabla de pagos) corre 100% en el servidor.
 * @returns {Promise<any>} El resultado del giro, incluyendo la combinación, el premio y las fichas restantes.
 */
export const playSlot = httpsCallable(functions, 'playSlot');