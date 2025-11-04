import React, { useState, useEffect, useContext, useRef, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import './DominoGame.css'; // <-- Mantenemos esta importación
import { db, functions } from '../../firebase';
import { AuthContext } from '../../App';
import {
    collection, query, orderBy, limit, onSnapshot,
    doc, updateDoc, getDoc
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

// --- NUEVA LÍNEA DE IMPORTACIÓN ---
import { PlayerAvatar } from './PlayerAvatar';

const DOMINO_CONSTANTS = {
    TARGET_SCORE_TOURNAMENT: 100,
    MAX_PLAYERS: 4,
};

const START_GAME_DELAY_SECONDS = 60;
const TURN_TIMEOUT_SECONDS = 30;
const PASS_TIMEOUT_SECONDS = 10;

const EMOJI_REACTIONS = ['😂', '😎', '😠', '😢', '🔥', '👍'];

// --- NUEVA CONSTANTE PARA DETECTAR MÓVIL ---
const isMobile = /Mobi/i.test(window.navigator.userAgent);

function getValidMoves(hand, board) {
    const validMoves = [];
    if (!hand || !Array.isArray(hand)) return [];
    if (!board || !Array.isArray(board) || board.length === 0) {
        hand.forEach((tile, index) => {
            if (tile) validMoves.push({ tileIndex: index, tile, position: 'start' });
        });
        return validMoves;
    }
    const firstTile = board[0];
    const lastTile = board[board.length - 1];
    if (typeof firstTile?.top !== 'number' || typeof lastTile?.bottom !== 'number') {
        console.error("Board tiles missing or invalid top/bottom properties:", {first: firstTile, last: lastTile});
        return [];
    }
    const startValue = firstTile.top;
    const endValue = lastTile.bottom;

    hand.forEach((tile, index) => {
        if (!tile || typeof tile.top !== 'number' || typeof tile.bottom !== 'number') return;
        const canPlayStart = tile.top === startValue || tile.bottom === startValue;
        const canPlayEnd = tile.top === endValue || tile.bottom === endValue;
        if (canPlayStart) {
            validMoves.push({ tileIndex: index, tile, position: 'start' });
        }
        if (canPlayEnd && (!canPlayStart || startValue !== endValue)) {
            validMoves.push({ tileIndex: index, tile, position: 'end' });
        }
    });
    return validMoves;
}

/*
* =======================================================================
* FUNCIÓN calculateBoardLayout CORREGIDA (V8)
* =======================================================================
*/
function calculateBoardLayout(board, containerWidth, containerHeight, tileScale, selectedTile) {
    const TILE_HEIGHT_NORMAL = Math.max(20, Math.floor(containerHeight / tileScale));
    const TILE_WIDTH_NORMAL = TILE_HEIGHT_NORMAL * 2;
    const TILE_GAP = Math.max(2, Math.floor(TILE_HEIGHT_NORMAL / 10));
    const BOARD_PADDING = Math.max(5, Math.floor(TILE_HEIGHT_NORMAL / 3));

    if (!board || board.length === 0 || containerWidth === 0) {
        return { layout: [], ends: { start: null, end: null } };
    }
    
    const chain = new Array(board.length);
    const midIndex = Math.floor(board.length / 2);
    const openerTile = board[midIndex];
    
    const limits = {
        minX: BOARD_PADDING,
        maxX: containerWidth - BOARD_PADDING,
        minY: BOARD_PADDING,
        maxY: containerHeight - BOARD_PADDING,
    };

    const turnRight = (dir) => (dir[0] === 1 ? [0, 1] : dir[0] === -1 ? [0, -1] : dir[1] === 1 ? [-1, 0] : [1, 0]);
    const turnLeft = (dir) => (dir[0] === 1 ? [0, -1] : dir[0] === -1 ? [0, 1] : dir[1] === 1 ? [1, 0] : [-1, 0]);

    // --- LÓGICA V8: Restaurada a la lógica ORIGINAL que te gusta (la "T") ---
    const getTileProps = (tile, dir) => {
        const isDouble = tile.top === tile.bottom;
        let w, h, rotation, orientationClass;
        
        w = TILE_WIDTH_NORMAL;
        h = TILE_HEIGHT_NORMAL;
        orientationClass = 'normal';

        if (isDouble) {
            if (dir[0] !== 0) { // Si la línea es horizontal
                rotation = 90; // Poner doble vertical (cruzado)
            } else { // Si la línea es vertical
                rotation = 0; // Poner doble horizontal (acostado)
            }
        }
        else if (dir[0] !== 0) { // Ficha normal, línea horizontal
            rotation = 0; 
        } else { // Ficha normal, línea vertical
            rotation = -90; 
        }
        return { w, h, rotation, isDouble, orientationClass };
    };
    
    const openerIsDouble = openerTile.top === openerTile.bottom;
    const openerProps = {
        w: TILE_WIDTH_NORMAL,
        h: TILE_HEIGHT_NORMAL,
        rotation: openerIsDouble ? 90 : 0,
        isDouble: openerIsDouble,
        orientationClass: 'normal'
    };
    
    const openerIsVertical = (openerProps.rotation === 90 || openerProps.rotation === -90);
    const openerRenderedW = openerIsVertical ? openerProps.h : openerProps.w;
    const openerRenderedH = openerIsVertical ? openerProps.w : openerProps.h;

    const midLayout = {
        tile: openerTile,
        x: containerWidth / 2,
        y: containerHeight / 2,
        ...openerProps,
        renderedW: openerRenderedW,
        renderedH: openerRenderedH
    };
    chain[midIndex] = midLayout;

    // --- RAMA "END" (Hacia adelante) ---
    let endHead = {
        x: midLayout.x,
        y: midLayout.y,
        dir: [1, 0],
        prevLayout: midLayout
    };
    let hasTurnedEnd = false;

    for (let i = midIndex + 1; i < board.length; i++) {
        const tile = board[i];
        let { w, h, rotation, isDouble, orientationClass } = getTileProps(tile, endHead.dir);
        let prevLayout = endHead.prevLayout;
        
        if (hasTurnedEnd && endHead.dir[0] !== 0 && !isDouble) {
            rotation = 180;
        }

        let prevRenderedW = prevLayout.renderedW;
        let prevRenderedH = prevLayout.renderedH;

        let newIsVertical = (rotation === 90 || rotation === -90);
        let newRenderedW = newIsVertical ? h : w;
        let newRenderedH = newIsVertical ? w : h;
        // --- CORRECCIÓN V8: Incluir dobles acostados (rotation 0) en las dimensiones (w,h) ---
        if (rotation === 180 || (isDouble && rotation === 0)) {
             newRenderedW = w;
             newRenderedH = h;
        }


        let halfPrev, halfNew, nextX, nextY;
        if (endHead.dir[0] !== 0) { // Moviendo en Horizontal
            halfPrev = prevRenderedW / 2;
            halfNew = newRenderedW / 2;
            nextX = endHead.x + endHead.dir[0] * (halfPrev + halfNew + TILE_GAP);
            nextY = endHead.y;
        } else { // Moviendo en Vertical
            halfPrev = prevRenderedH / 2;
            halfNew = newRenderedH / 2;
            nextX = endHead.x;
            nextY = endHead.y + endHead.dir[1] * (halfPrev + halfNew + TILE_GAP);
        }

        let didTurn = false;

        // --- INICIO DE LÓGICA DE "GIRO PREVENTIVO" (V8 - AMBAS DIRECCIONES) ---
        if (i < board.length - 1 && !hasTurnedEnd) {
            const nextTileInList = board[i + 1];
            const nextTileIsDouble = nextTileInList.top === nextTileInList.bottom;

            if (nextTileIsDouble) {
                let currentTile_X = nextX, currentTile_Y = nextY;
                let currentTile_RenderedW = newRenderedW, currentTile_RenderedH = newRenderedH;
                
                let nextTileProps = getTileProps(nextTileInList, endHead.dir);
                
                let nextIsVertical_Simulated = (nextTileProps.rotation === 90 || nextTileProps.rotation === -90);
                let nextTile_Simulated_W = nextIsVertical_Simulated ? nextTileProps.h : nextTileProps.w;
                let nextTile_Simulated_H = nextIsVertical_Simulated ? nextTileProps.w : nextTileProps.h;
                if (nextTileProps.isDouble && nextTileProps.rotation === 0) {
                     nextTile_Simulated_W = nextTileProps.w;
                     nextTile_Simulated_H = nextTileProps.h;
                }
                
                let willCollide = false;

                if (endHead.dir[0] !== 0) {
                    // --- Chequeo H->V (Lados Izquierdo/Derecho) ---
                    let nextTile_Simulated_X = currentTile_X + endHead.dir[0] * (currentTile_RenderedW / 2 + nextTile_Simulated_W / 2 + TILE_GAP);
                    let nextLeft_Simulated = nextTile_Simulated_X - (nextTile_Simulated_W / 2);
                    let nextRight_Simulated = nextTile_Simulated_X + (nextTile_Simulated_W / 2);
                    
                    if (nextRight_Simulated > limits.maxX || nextLeft_Simulated < limits.minX) {
                        willCollide = true;
                    }

                } else {
                    // --- Chequeo V->H (Arriba/Abajo) ---
                    let nextTile_Simulated_Y = currentTile_Y + endHead.dir[1] * (currentTile_RenderedH / 2 + nextTile_Simulated_H / 2 + TILE_GAP);
                    let nextTop_Simulated = nextTile_Simulated_Y - (nextTile_Simulated_H / 2);
                    let nextBottom_Simulated = nextTile_Simulated_Y + (nextTile_Simulated_H / 2);

                    if (nextBottom_Simulated > limits.maxY || nextTop_Simulated < limits.minY) {
                        willCollide = true;
                    }
                }

                if (willCollide) {
                    // ¡SÍ! El doble va a chocar. Forzamos el giro AHORA.
                    hasTurnedEnd = true;
                    didTurn = true;
                    const oldDir = [...endHead.dir];
                    endHead.dir = turnLeft(endHead.dir);
                    
                    ({ w, h, rotation, isDouble, orientationClass } = getTileProps(tile, endHead.dir));
                    newIsVertical = (rotation === 90 || rotation === -90);
                    newRenderedW = newIsVertical ? h : w;
                    newRenderedH = newIsVertical ? w : h;
                    if(rotation === 180 || (isDouble && rotation === 0)) { newRenderedW = w; newRenderedH = h; }

                    let prevIsVertical = (prevLayout.rotation === 90 || prevLayout.rotation === -90);
                    prevRenderedW = prevIsVertical ? prevLayout.h : prevLayout.w;
                    prevRenderedH = prevIsVertical ? prevLayout.w : prevLayout.h;

                    // Recalculamos su posición (el "codo")
                    if (oldDir[0] !== 0) { // Giro fue de Horizontal a Vertical
                        nextX = endHead.x + oldDir[0] * (prevRenderedW / 4); 
                        nextY = endHead.y + endHead.dir[1] * (prevRenderedH / 2 + TILE_GAP + newRenderedH / 2);
                    } else { // Giro fue de Vertical a Horizontal
                        nextX = endHead.x + endHead.dir[0] * (prevRenderedW / 2 + TILE_GAP + newRenderedW / 2);
                        nextY = endHead.y + oldDir[1] * (prevRenderedH / 4);
                    }
                }
            }
        }
        // --- FIN DE LÓGICA DE "GIRO PREVENTIVO" ---

        // --- INICIO DE LÓGICA DE "GIRO NORMAL" ---
        let nextLeft = nextX - (newRenderedW / 2);
        let nextRight = nextX + (newRenderedW / 2);
        let nextTop = nextY - (newRenderedH / 2);
        let nextBottom = nextY + (newRenderedH / 2);

        if (!didTurn && (nextRight > limits.maxX || nextLeft < limits.minX || nextBottom > limits.maxY || nextTop < limits.minY)) {
            // Giro normal (la ficha actual choca)
            hasTurnedEnd = true;
            didTurn = true;
            const oldDir = [...endHead.dir];
            endHead.dir = turnLeft(endHead.dir); // Gira a la izquierda
            
            ({ w, h, rotation, isDouble, orientationClass } = getTileProps(tile, endHead.dir));
            
            if (hasTurnedEnd && endHead.dir[0] !== 0 && !isDouble) {
                rotation = 180;
            }

            newIsVertical = (rotation === 90 || rotation === -90);
            newRenderedW = newIsVertical ? h : w;
            newRenderedH = newIsVertical ? w : h;
            if(rotation === 180 || (isDouble && rotation === 0)) { newRenderedW = w; newRenderedH = h; }
            
            let prevIsVertical = (prevLayout.rotation === 90 || prevLayout.rotation === -90);
            prevRenderedW = prevIsVertical ? prevLayout.h : prevLayout.w;
            prevRenderedH = prevIsVertical ? prevLayout.w : prevLayout.h;

            if (oldDir[0] !== 0) { // Giro fue de Horizontal a Vertical
                nextX = endHead.x + oldDir[0] * (prevRenderedW / 4); 
                nextY = endHead.y + endHead.dir[1] * (prevRenderedH / 2 + TILE_GAP + newRenderedH / 2);
            } else { // Giro fue de Vertical a Horizontal
                nextX = endHead.x + endHead.dir[0] * (prevRenderedW / 2 + TILE_GAP + newRenderedW / 2);
                nextY = endHead.y + oldDir[1] * (prevRenderedH / 4);
            }
        }
        // --- FIN DE LÓGICA DE "GIRO NORMAL" ---
        
        const finalLayout = { tile, x: nextX, y: nextY, w, h, rotation, isDouble, orientationClass, renderedW: newRenderedW, renderedH: newRenderedH };
        chain[i] = finalLayout;
        endHead = { x: nextX, y: nextY, dir: endHead.dir, prevLayout: finalLayout };
    }
    
    // --- RAMA "START" (Hacia atrás) ---
    let startHead = {
        x: midLayout.x,
        y: midLayout.y,
        dir: [-1, 0],
        prevLayout: midLayout
    };
    let hasTurnedStart = false;
    
    for (let i = midIndex - 1; i >= 0; i--) {
        const tile = board[i];
        let { w, h, rotation, isDouble, orientationClass } = getTileProps(tile, startHead.dir);
        let prevLayout = startHead.prevLayout;

        if (hasTurnedStart && startHead.dir[0] !== 0 && !isDouble) {
            rotation = 180;
        }

        let prevRenderedW = prevLayout.renderedW;
        let prevRenderedH = prevLayout.renderedH;

        let newIsVertical = (rotation === 90 || rotation === -90);
        let newRenderedW = newIsVertical ? h : w;
        let newRenderedH = newIsVertical ? w : h;
        if(rotation === 180 || (isDouble && rotation === 0)) {
            newRenderedW = w;
            newRenderedH = h;
        }

        let halfPrev, halfNew, nextX, nextY;
        if (startHead.dir[0] !== 0) {
            halfPrev = prevRenderedW / 2;
            halfNew = newRenderedW / 2;
            nextX = startHead.x + startHead.dir[0] * (halfPrev + halfNew + TILE_GAP);
            nextY = startHead.y;
        } else {
            halfPrev = prevRenderedH / 2;
            halfNew = newRenderedH / 2;
            nextX = startHead.x;
            nextY = startHead.y + startHead.dir[1] * (halfPrev + halfNew + TILE_GAP);
        }

        let didTurn = false;

        // --- INICIO DE LÓGICA DE "GIRO PREVENTIVO" (TODAS LAS DIRECCIONES) ---
        if (i > 0 && !hasTurnedStart) {
            const nextTileInList = board[i - 1];
            const nextTileIsDouble = nextTileInList.top === nextTileInList.bottom;

            if (nextTileIsDouble) {
                let currentTile_X = nextX, currentTile_Y = nextY;
                let currentTile_RenderedW = newRenderedW, currentTile_RenderedH = newRenderedH;

                let nextTileProps = getTileProps(nextTileInList, startHead.dir);
                let nextIsVertical_Simulated = (nextTileProps.rotation === 90 || nextTileProps.rotation === -90);
                let nextTile_Simulated_W = nextIsVertical_Simulated ? nextTileProps.h : nextTileProps.w;
                let nextTile_Simulated_H = nextIsVertical_Simulated ? nextTileProps.w : nextTileProps.h;
                if (nextTileProps.isDouble && nextTileProps.rotation === 0) {
                     nextTile_Simulated_W = nextTileProps.w;
                     nextTile_Simulated_H = nextTileProps.h;
                }
                
                let willCollide = false;

                if (startHead.dir[0] !== 0) {
                    // --- Chequeo H->V (Lados Izquierdo/Derecho) ---
                    let nextTile_Simulated_X = currentTile_X + startHead.dir[0] * (currentTile_RenderedW / 2 + nextTile_Simulated_W / 2 + TILE_GAP);
                    let nextLeft_Simulated = nextTile_Simulated_X - (nextTile_Simulated_W / 2);
                    let nextRight_Simulated = nextTile_Simulated_X + (nextTile_Simulated_W / 2);

                    if (nextRight_Simulated > limits.maxX || nextLeft_Simulated < limits.minX) {
                        willCollide = true;
                    }
                } else {
                    // --- Chequeo V->H (Arriba/Abajo) ---
                    let nextTile_Simulated_Y = currentTile_Y + startHead.dir[1] * (currentTile_RenderedH / 2 + nextTile_Simulated_H / 2 + TILE_GAP);
                    let nextTop_Simulated = nextTile_Simulated_Y - (nextTile_Simulated_H / 2);
                    let nextBottom_Simulated = nextTile_Simulated_Y + (nextTile_Simulated_H / 2);

                    if (nextBottom_Simulated > limits.maxY || nextTop_Simulated < limits.minY) {
                        willCollide = true;
                    }
                }

                if (willCollide) {
                    // ¡SÍ! El doble va a chocar. Forzamos el giro AHORA.
                    hasTurnedStart = true;
                    didTurn = true;
                    const oldDir = [...startHead.dir];
                    startHead.dir = turnLeft(startHead.dir);
                    
                    ({ w, h, rotation, isDouble, orientationClass } = getTileProps(tile, startHead.dir));
                    
                    newIsVertical = (rotation === 90 || rotation === -90);
                    newRenderedW = newIsVertical ? h : w;
                    newRenderedH = newIsVertical ? w : h;
                    if(rotation === 180 || (isDouble && rotation === 0)) { newRenderedW = w; newRenderedH = h; }
                    
                    let prevIsVertical = (prevLayout.rotation === 90 || prevLayout.rotation === -90);
                    prevRenderedW = prevIsVertical ? prevLayout.h : prevLayout.w;
                    prevRenderedH = prevIsVertical ? prevLayout.w : prevLayout.h;
                    
                    // Recalculamos su posición (el "codo")
                    if (oldDir[0] !== 0) { // Giro fue de Horizontal a Vertical
                        nextX = startHead.x + oldDir[0] * (prevRenderedW / 4); 
                        nextY = startHead.y + startHead.dir[1] * (prevRenderedH / 2 + TILE_GAP + newRenderedH / 2);
                    } else { // Giro fue de Vertical a Horizontal
                        nextX = startHead.x + endHead.dir[0] * (prevRenderedW / 2 + TILE_GAP + newRenderedW / 2);
                        nextY = startHead.y + oldDir[1] * (prevRenderedH / 4);
                    }
                }
            }
        }
        // --- FIN DE LÓGICA DE "GIRO PREVENTIVO" ---
        
        // --- INICIO DE LÓGICA DE "GIRO NORMAL" ---
        let nextLeft = nextX - (newRenderedW / 2);
        let nextRight = nextX + (newRenderedW / 2);
        let nextTop = nextY - (newRenderedH / 2);
        let nextBottom = nextY + (newRenderedH / 2);

        if (!didTurn && (nextRight > limits.maxX || nextLeft < limits.minX || nextBottom > limits.maxY || nextTop < limits.minY)) {
            hasTurnedStart = true;
            didTurn = true;
            const oldDir = [...startHead.dir];
            startHead.dir = turnLeft(startHead.dir);
            
            ({ w, h, rotation, isDouble, orientationClass } = getTileProps(tile, startHead.dir));
            
            if (hasTurnedStart && startHead.dir[0] !== 0 && !isDouble) {
                rotation = 180;
            }

            newIsVertical = (rotation === 90 || rotation === -90);
            newRenderedW = newIsVertical ? h : w;
            newRenderedH = newIsVertical ? w : h;
            if(rotation === 180 || (isDouble && rotation === 0)) { newRenderedW = w; newRenderedH = h; }
            
            let prevIsVertical = (prevLayout.rotation === 90 || prevLayout.rotation === -90);
            prevRenderedW = prevIsVertical ? prevLayout.h : prevLayout.w;
            prevRenderedH = prevIsVertical ? prevLayout.w : prevLayout.h;

            if (oldDir[0] !== 0) { // Giro fue de Horizontal a Vertical
                nextX = startHead.x + oldDir[0] * (prevRenderedW / 4); 
                nextY = startHead.y + startHead.dir[1] * (prevRenderedH / 2 + TILE_GAP + newRenderedH / 2);
            } else { // Giro fue de Vertical a Horizontal
                nextX = startHead.x + startHead.dir[0] * (prevRenderedW / 2 + TILE_GAP + newRenderedW / 2);
                nextY = startHead.y + oldDir[1] * (prevRenderedH / 4);
            }
        }
        // --- FIN DE LÓGICA DE "GIRO NORMAL" ---
        
        const finalLayout = { tile, x: nextX, y: nextY, w, h, rotation, isDouble, orientationClass, renderedW: newRenderedW, renderedH: newRenderedH };
        chain[i] = finalLayout;
        startHead = { x: nextX, y: nextY, dir: startHead.dir, prevLayout: finalLayout };
    }

    const startLayout = chain[0];
    const endLayout = chain[chain.length - 1];
    
    const getEndHighlightProps = (layoutTile, isStart, endDir, selectedTile) => {
        if (!layoutTile || !selectedTile) return null;

        let tempDir = [...endDir];
        let { w, h, rotation, isDouble, orientationClass } = getTileProps(selectedTile, tempDir);
        
        let prevLayout = isStart ? startLayout : endLayout;
        let prevIsVertical = (prevLayout.rotation === 90 || prevLayout.rotation === -90);
        let prevRenderedW = prevIsVertical ? prevLayout.h : prevLayout.w;
        let prevRenderedH = prevIsVertical ? prevLayout.w : prevLayout.h;

        let newIsVertical = (rotation === 90 || rotation === -90);
        let newRenderedW = newIsVertical ? h : w;
        let newRenderedH = newIsVertical ? w : h;
        if (rotation === 180 || (isDouble && rotation === 0)) {
             newRenderedW = w;
             newRenderedH = h;
        }
        
        let nextX, nextY;

        if (tempDir[0] !== 0) { // Siguiente movimiento es Horizontal
            halfPrev = prevRenderedW / 2;
            halfNew = newRenderedW / 2;
            nextX = prevLayout.x + tempDir[0] * (halfPrev + halfNew + TILE_GAP);
            nextY = prevLayout.y;
        } else { // Siguiente movimiento es Vertical
            halfPrev = prevRenderedH / 2;
            halfNew = newRenderedH / 2;
            nextX = prevLayout.x;
            nextY = prevLayout.y + tempDir[1] * (halfPrev + halfNew + TILE_GAP);
        }
        
        let nextLeft = nextX - (newRenderedW / 2);
        let nextRight = nextX + (newRenderedW / 2);
        let nextTop = nextY - (newRenderedH / 2);
        let nextBottom = nextY + (newRenderedH / 2);

        if (nextRight > limits.maxX || nextLeft < limits.minX || nextBottom > limits.maxY || nextTop < limits.minY) {
            const oldDir = [...tempDir];
            tempDir = turnLeft(tempDir);
            
            ({ w, h, rotation, isDouble, orientationClass } = getTileProps(selectedTile, tempDir));
            
            if ( (isStart ? hasTurnedStart : hasTurnedEnd) && tempDir[0] !== 0 && !isDouble) {
                rotation = 180;
            }

            newIsVertical = (rotation === 90 || rotation === -90);
            newRenderedW = newIsVertical ? h : w;
            newRenderedH = newIsVertical ? w : h;
            if(rotation === 180 || (isDouble && rotation === 0)) {
                newRenderedW = w;
                newRenderedH = h;
            }

            if (oldDir[0] !== 0) { // Giro fue de Horizontal a Vertical
                nextX = prevLayout.x + oldDir[0] * (prevRenderedW / 4);
                nextY = prevLayout.y + tempDir[1] * (prevRenderedH / 2 + TILE_GAP + newRenderedH / 2);
            } else { // Giro fue de Vertical a Horizontal
                nextX = prevLayout.x + tempDir[0] * (prevRenderedW / 2 + TILE_GAP + newRenderedW / 2);
                nextY = prevLayout.y + oldDir[1] * (prevRenderedH / 4);
            }
        }
        
        return { x: nextX, y: nextY, w: newRenderedW, h: newRenderedH, rotation: rotation };
    };

    return {
        layout: chain,
        ends: {
            start: getEndHighlightProps(startLayout, true, startHead.dir, selectedTile),
            end: getEndHighlightProps(endLayout, false, endHead.dir, selectedTile)
        }
    };
}
/*
* =======================================================================
* FIN DE LA FUNCIÓN calculateBoardLayout CORREGIDA
* =======================================================================
*/


const calculateRemainingTime = (startTime, durationSeconds) => {
    if (!startTime?.seconds) return durationSeconds;
    const now = Date.now() / 1000;
    const elapsed = now - startTime.seconds;
    return Math.max(0, Math.ceil(durationSeconds - elapsed));
};

// --- PlayerAvatar HA SIDO MOVIDO a PlayerAvatar.jsx ---

const Pips = ({ value }) => {
    const pips = [];
    const pipLayouts = {
        0: [], 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 2, 3, 4, 5, 6],
    };

    if (pipLayouts[value] !== undefined) {
        pipLayouts[value].forEach((pos, index) => {
            pips.push(<div key={index} className={`pip pip-${pos}`}></div>);
        });
    }
    return <div className={`pipContainer pips-${value}`}>{pips}</div>;
};

// --- ELIMINADO: Componente TopBarOpponent ---

const DominoTile = ({ topValue, bottomValue, isInHand = false, onClick, isDisabled = false, isPlayableHighlight = false, isSelectedHighlight = false, isDouble, className = '', orientationClass: propOrientationClass }) => {
    
    const orientationClass = isInHand
        ? (isDouble ? 'double' : 'normal')
        : (propOrientationClass || 'normal'); // Restaurado a la V1

    const safeTopValue = Number.isInteger(topValue) ? topValue : 0;
    const safeBottomValue = Number.isInteger(bottomValue) ? bottomValue : 0;
    const tileClasses = `tile ${isInHand ? 'inHand' : 'onBoard'} ${orientationClass} ${isDisabled ? 'disabled' : ''} ${isPlayableHighlight ? 'playableHighlight' : ''} ${isSelectedHighlight ? 'selectedHighlight' : ''} ${className}`;

    return (
        <div className={tileClasses} onClick={!isDisabled ? onClick : undefined}>
            <div className="half">
                <Pips value={safeTopValue} />
            </div>
            <div className="divider"></div>
            <div className="half">
                <Pips value={safeBottomValue} />
            </div>
        </div>
    );
};

const OpponentHand = ({ hand, position }) => {
    if (!hand || hand.length === 0) return null;
    const handClasses = `opponentHand ${position}`;

    return (
    <div className={handClasses}>
        {hand.map((tile, index) => (
        <div key={`opp-tile-${index}-${tile?.top ?? 'x'}-${tile?.bottom ?? 'y'}`} className="opponentTileWrapper">
            {tile && (
                <DominoTile
                topValue={tile.top}
                bottomValue={tile.bottom}
                isDouble={tile.top === tile.bottom}
                isInHand={true}
                className="opponentTile"
                isDisabled={true}
                />
            )}
        </div>
        ))}
    </div>
    );
};

function DominoGame() {
    const { gameId } = useParams();
    const navigate = useNavigate();
    const { currentUser } = useContext(AuthContext);
    const { search } = useLocation();
    const queryParams = new URLSearchParams(search);
    const isSpectator = queryParams.get('spectate') === 'true';

    const [gameData, setGameData] = useState(null);
    const [players, setPlayers] = useState({});
    const [myHand, setMyHand] = useState([]);
    const [messages, setMessages] = useState([]);
    const [chatInput, setChatInput] = useState('');
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isEmojiPanelOpen, setIsEmojiPanelOpen] = useState(false);
    const [isMyPlayerReady, setIsMyPlayerReady] = useState(false);
    const chatMessagesEndRef = useRef(null);
    const [loadingAction, setLoadingAction] = useState(false);
    const [startCountdownRemaining, setStartCountdownRemaining] = useState(null);
    const [turnTimerRemaining, setTurnTimerRemaining] = useState(null);

    // --- ESTADO PARA EL TOAST ---
    const [toastMessage, setToastMessage] = useState(null);
    const toastTimerRef = useRef(null);

    const [selectedTileInfo, setSelectedTileInfo] = useState(null);
    const [playableEnds, setPlayableEnds] = useState({ start: false, end: false });

    const [showPassButton, setShowPassButton] = useState(false);

    const boardContainerRef = useRef(null);
    const [boardLimits, setBoardLimits] = useState({ width: 0, height: 0 });
    const [boardLayout, setBoardLayout] = useState([]);
    const [boardEnds, setBoardEnds] = useState({ start: null, end: null });

    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [tileScale, setTileScale] = useState(13);
    const [boardScale, setBoardScale] = useState(170);

    const [showGameOver, setShowGameOver] = useState(true);

    // --- AÑADIDO: LÓGICA DE PANTALLA COMPLETA ---
    const [isFullscreen, setIsFullscreen] = useState(false);

    // --- FUNCIÓN handleToggleFullscreen MODIFICADA ---
    const handleToggleFullscreen = async () => {
        try {
            if (!document.fullscreenElement) {
                // Entrar en pantalla completa
                await document.documentElement.requestFullscreen();
                
                // --- CAMBIO AQUÍ: Solo intentar bloquear en móvil ---
                if (isMobile && window.screen && window.screen.orientation && window.screen.orientation.lock) {
                    await window.screen.orientation.lock('landscape');
                }
            } else {
                // Salir de pantalla completa
                
                // --- CAMBIO AQUÍ: Solo intentar desbloquear en móvil ---
                if (isMobile && window.screen && window.screen.orientation && window.screen.orientation.unlock) {
                    window.screen.orientation.unlock();
                }
                await document.exitFullscreen(); // Salir *después* de desbloquear
            }
        } catch (err) {
            console.warn(`Error al gestionar pantalla completa/orientación: ${err.message}`);
        }
    };

    useEffect(() => {
        const onFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
            // Si salimos de pantalla completa (ej: con la tecla Esc) y la orientación sigue bloqueada, desbloquearla.
            if (!document.fullscreenElement) {
                // --- CAMBIO AQUÍ: Solo intentar desbloquear en móvil ---
                if (isMobile && window.screen && window.screen.orientation && window.screen.orientation.unlock) {
                    window.screen.orientation.unlock();
                }
            }
        };
        document.addEventListener('fullscreenchange', onFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
    }, []);
    // --- FIN LÓGICA PANTALLA COMPLETA ---

    // --- FUNCIÓN PARA MOSTRAR EL TOAST ---
    const showToast = (message) => {
        if (toastTimerRef.current) {
            clearTimeout(toastTimerRef.current);
        }
        setToastMessage(message);
        toastTimerRef.current = setTimeout(() => {
            setToastMessage(null);
            toastTimerRef.current = null;
        }, 3000); // El mensaje desaparece después de 3 segundos
    };

    const handleUpdateTileScale = (direction) => {
        setTileScale(prev => {
            const newScale = prev + direction;
            if (newScale < 9) return 9;
            if (newScale > 20) return 20;
            return newScale;
        });
    };

    const handleUpdateBoardScale = (direction) => {
        setBoardScale(prev => {
            const newScale = prev + (direction * 10);
            if (newScale < 120) return 120;
            if (newScale > 250) return 250;
            return newScale;
        });
    };

    useEffect(() => {
        const container = boardContainerRef.current;
        if (!container) return;
        
        const resizeObserver = new ResizeObserver(entries => {
            if (entries[0]) {
                const { width, height } = entries[0].contentRect;
                setBoardLimits({ width, height });

                const container = boardContainerRef.current;
                if (container) {
                    const baseH = Math.max(20, Math.floor(height / tileScale));
                    const baseW = baseH * 2;
                    container.style.setProperty('--tile-w-normal', `${baseW}px`);
                    container.style.setProperty('--tile-h-normal', `${baseH}px`);
                    container.style.setProperty('--pip-size', `${Math.max(4, Math.floor(baseH / 7))}px`);
                    container.style.setProperty('--tile-radius', `${Math.max(3, Math.floor(baseH / 6))}px`);
                    container.style.setProperty('--divider-size', `${Math.max(1, Math.floor(baseH / 18))}px`);
                }
            }
        });
        
        resizeObserver.observe(container);
        const { width, height } = container.getBoundingClientRect();
        if (width > 0 && height > 0) {
            setBoardLimits({ width, height });
            const baseH = Math.max(20, Math.floor(height / tileScale));
            const baseW = baseH * 2;
            container.style.setProperty('--tile-w-normal', `${baseW}px`);
            container.style.setProperty('--tile-h-normal', `${baseH}px`);
            container.style.setProperty('--pip-size', `${Math.max(4, Math.floor(baseH / 7))}px`);
            container.style.setProperty('--tile-radius', `${Math.max(3, Math.floor(baseH / 6))}px`);
            container.style.setProperty('--divider-size', `${Math.max(1, Math.floor(baseH / 18))}px`);
        }

        return () => resizeObserver.disconnect();
    }, [tileScale]);

    useEffect(() => {
        if (!gameData?.board || boardLimits.width === 0) {
            setBoardLayout([]);
            setBoardEnds({ start: null, end: null });
            return;
        }
        
        const { layout, ends } = calculateBoardLayout(gameData.board, boardLimits.width, boardLimits.height, tileScale, selectedTileInfo?.tile);
        setBoardLayout(layout);
        setBoardEnds(ends);

    }, [gameData?.board, boardLimits, tileScale, selectedTileInfo]);


    useEffect(() => {
        if (!gameId) return;
        const gameDocRef = doc(db, "domino_tournament_games", gameId);

        const unsubscribeGame = onSnapshot(gameDocRef, (docSnap) => {
            if (docSnap.exists()) {
                const newData = docSnap.data();
                setGameData(newData);
                
                if (newData.status === 'finished') {
                    setShowGameOver(true);
                }

                if (selectedTileInfo && (newData.currentTurn !== currentUser?.uid || newData.status !== 'playing')) {
                    setSelectedTileInfo(null);
                    setPlayableEnds({ start: false, end: false });
                }
            } else {
                console.error("Game not found!");
                alert("La partida ya no existe o ha finalizado.");
                setSelectedTileInfo(null);
                setPlayableEnds({ start: false, end: false });
                navigate('/domino');
            }
        }, (error) => {
            console.error("Error listening to game:", error);
        });

        const playersColRef = collection(db, "domino_tournament_games", gameId, "players");
        const unsubscribePlayers = onSnapshot(playersColRef, (snapshot) => {
            const playersMap = {};
            let foundMyHandData = false;
            snapshot.docs.forEach(doc => {
                const playerData = { id: doc.id, ...doc.data() };
                playersMap[doc.id] = playerData;
                if (doc.id === currentUser?.uid) {
                    setMyHand(playerData.hand || []);
                    setIsMyPlayerReady(playerData.isReady || false);
                    foundMyHandData = true;
                }
            });
            setPlayers(playersMap);
            if (!foundMyHandData && !isSpectator) {
                setMyHand([]);
                setIsMyPlayerReady(false);
            }
        }, (error) => {
            console.error("Error listening to players:", error);
        });

        return () => {
            unsubscribeGame();
            unsubscribePlayers();
        };
    }, [gameId, currentUser, navigate, isSpectator]);

    useEffect(() => {
        if (!gameId) return;
        const q = query(collection(db, "domino_chat", gameId, "messages"), orderBy("timestamp", "desc"), limit(20));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setMessages(msgs.reverse());
        });
        return () => unsubscribe();
    }, [gameId]);

    useEffect(() => {
        if (isChatOpen) {
            chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, isChatOpen]);

    useEffect(() => {
        let startTimerId;
        let turnTimerId;

        if (gameData?.startCountdownAt && gameData.status === 'full') {
            const updateStartCountdown = () => {
                const remaining = calculateRemainingTime(gameData.startCountdownAt, START_GAME_DELAY_SECONDS);
                setStartCountdownRemaining(remaining);
                if (remaining > 0) {
                    startTimerId = setTimeout(updateStartCountdown, 1000);
                } else {
                    setStartCountdownRemaining(null);
                }
            };
            updateStartCountdown();
        } else {
            setStartCountdownRemaining(null);
        }

        if (gameData?.turnStartTime && gameData.status === 'playing' && gameData.currentTurn) {
            const updateTurnTimer = () => {
                const duration = gameData.turnTimeoutSeconds || TURN_TIMEOUT_SECONDS;
                const remaining = calculateRemainingTime(gameData.turnStartTime, duration);
                setTurnTimerRemaining(remaining);
                if (remaining > 0) {
                    turnTimerId = setTimeout(updateTurnTimer, 1000);
                } else {
                    setTurnTimerRemaining(null);
                }
            };
            updateTurnTimer();
        } else {
            setTurnTimerRemaining(null);
        }

        return () => {
            clearTimeout(startTimerId);
            clearTimeout(turnTimerId);
        };
    }, [gameData]);


    const handleSendChat = async (e) => {
        e.preventDefault();
        const trimmedInput = chatInput.trim();
        const myUsername = players[currentUser?.uid]?.username || 'Jugador';
        if (!trimmedInput || !currentUser || !myUsername || !gameId || isSpectator) return;
        setChatInput('');
        try {
            const sendMessageFunc = httpsCallable(functions, 'sendDominoMessage');
            await sendMessageFunc({ gameId: gameId, text: trimmedInput });
        } catch (error) {
            console.error("Error sending chat:", error);
            setChatInput(trimmedInput);
            alert(`Error al enviar mensaje: ${error.message}`);
        }
    };

    const handleSendReaction = async (emoji) => {
        if (!currentUser || !gameId || isSpectator) return;
        setIsEmojiPanelOpen(false);
        const playerDocRef = doc(db, "domino_tournament_games", gameId, "players", currentUser.uid);
        const currentReaction = players[currentUser.uid]?.currentReaction;
        try {
            setPlayers(prev => ({ ...prev, [currentUser.uid]: { ...(prev[currentUser.uid] || {}), currentReaction: emoji } }));
            await updateDoc(playerDocRef, { currentReaction: emoji });

            setTimeout(async () => {
                try {
                    const playerSnap = await getDoc(playerDocRef);
                    if (playerSnap.exists() && playerSnap.data().currentReaction === emoji) {
                        await updateDoc(playerDocRef, { currentReaction: null });
                    }
                } catch (error) {
                    console.error("Error clearing reaction:", error);
                }
            }, 3000);
        } catch (error) {
            console.error("Error sending reaction:", error);
            setPlayers(prev => ({ ...prev, [currentUser.uid]: { ...(prev[currentUser.uid] || {}), currentReaction: currentReaction } }));
            alert(`Error al enviar reacción: ${error.message}`);
        }
    };

    const handleToggleReady = async () => {
        if (!currentUser || !gameId || gameData?.status !== 'full' || isSpectator || loadingAction) return;
        setLoadingAction(true);
        try {
            const toggleReadyFunc = httpsCallable(functions, 'handleReadyToggle');
            await toggleReadyFunc({ gameId: gameId });
        } catch (error) {
            console.error("Error toggling ready:", error);
            alert(`Error al marcar listo: ${error.message}`);
        } finally {
            setLoadingAction(false);
        }
    };

    const executePlayTile = async (tile, position) => {
        setLoadingAction(true);
        setSelectedTileInfo(null);
        setPlayableEnds({ start: false, end: false });
        try {
            const playTileFunc = httpsCallable(functions, 'playDominoTile');
            await playTileFunc({ gameId: gameId, tile: tile, position: position });
        } catch (error) {
            console.error(`Error playing tile at ${position}:`, error);
            alert(`Error al jugar ficha: ${error.message}`);
        } finally {
            setLoadingAction(false);
        }
    };

    const handleTileClick = (clickedTile, indexInHand) => {
        if (!currentUser || !gameId || gameData?.currentTurn !== currentUser?.uid || loadingAction || isSpectator || gameData.status !== 'playing') return;

        const scores = gameData.scores || {};
        const isFirstRound = Object.values(scores).every(s => s === 0);
        if (isFirstRound && (gameData.board || []).length === 0) {
            const hasSixDouble = myHand.some(t => t.top === 6 && t.bottom === 6);
            if (hasSixDouble && (clickedTile.top !== 6 || clickedTile.bottom !== 6)) {
                alert("Debes salir con el doble 6.");
                return;
            }
        }

        if (selectedTileInfo?.index === indexInHand) {
            setSelectedTileInfo(null);
            setPlayableEnds({ start: false, end: false });
            return;
        }

        const movesForThisTile = getValidMoves([clickedTile], gameData.board).map(move => move.position);

        if (movesForThisTile.length === 0) return;

        if (movesForThisTile.length === 1) {
            setSelectedTileInfo(null);
            setPlayableEnds({ start: false, end: false });
            executePlayTile(clickedTile, movesForThisTile[0]);
        } else if (movesForThisTile.length === 2) {
            setSelectedTileInfo({ tile: clickedTile, index: indexInHand });
            setPlayableEnds({
                start: movesForThisTile.includes('start'),
                end: movesForThisTile.includes('end')
            });
        }
    };

    const handleBoardEndClick = (position) => {
        if (!selectedTileInfo || !playableEnds[position]) return;
        executePlayTile(selectedTileInfo.tile, position);
    };


    const handlePassTurn = async () => {
        if (!currentUser || !gameId || gameData?.currentTurn !== currentUser?.uid || loadingAction || isSpectator || selectedTileInfo) return;

        const scores = gameData.scores || {};
        const isFirstRound = Object.values(scores).every(s => s === 0);
        if (isFirstRound && (gameData.board || []).length === 0) {
            const hasSixDouble = myHand.some(t => t.top === 6 && t.bottom === 6);
            if (hasSixDouble) {
                alert("No puedes pasar, debes salir con el doble 6.");
                return;
            }
        }

        const moves = getValidMoves(myHand, gameData?.board);
        if (moves.length > 0) {
            console.warn("Intento de pasar con jugadas válidas.");
            alert("Tienes jugadas disponibles, no puedes pasar.");
            return;
        }

        setLoadingAction(true);
        try {
            const passTurnFunc = httpsCallable(functions, 'passDominoTurn');
            await passTurnFunc({ gameId: gameId });
        } catch (error) {
            console.error("Error passing turn:", error);
            alert(`Error al pasar turno: ${error.message}`);
        } finally {
            setLoadingAction(false);
        }
    };

    const { playableTileIndices } = useMemo(() => {
        let hasNoMoves = false;
        let canPass = false;
        if (myHand && gameData?.board) {
            const moves = getValidMoves(myHand, gameData.board);
            hasNoMoves = moves.length === 0;

            const scores = gameData.scores || {};
            const isFirstRound = Object.values(scores).every(s => s === 0);
            if (isFirstRound && gameData.board.length === 0) {
                const hasSixDouble = myHand.some(t => t.top === 6 && t.bottom === 6);
                canPass = hasNoMoves && !hasSixDouble;
            } else {
                canPass = hasNoMoves;
            }
        }
        
        const shouldShow = gameData?.status === 'playing' &&
                                gameData.currentTurn === currentUser?.uid &&
                                !isSpectator &&
                                !selectedTileInfo &&
                                canPass;
        setShowPassButton(shouldShow);

        if (gameData?.status !== 'playing' || gameData.currentTurn !== currentUser?.uid || !gameData?.board || isSpectator || !myHand || selectedTileInfo) {
            return { playableTileIndices: new Set() };
        }

        const moves = getValidMoves(myHand, gameData.board);
        const indices = new Set(moves.map(m => m.tileIndex));
        
        const scores = gameData.scores || {};
        const isFirstRound = Object.values(scores).every(s => s === 0);
        if (isFirstRound && gameData.board.length === 0) {
            let sixDoubleIndex = -1;
            for (let i = 0; i < myHand.length; i++) {
                if (myHand[i]?.top === 6 && myHand[i]?.bottom === 6) {
                    sixDoubleIndex = i;
                    break;
                }
            }
            if (sixDoubleIndex !== -1) {
                return { playableTileIndices: new Set([sixDoubleIndex]) };
            }
        }

        return { playableTileIndices: indices };
    }, [gameData, myHand, currentUser, isSpectator, selectedTileInfo]);


    const playerPositions = ['playerBottom', 'playerLeft', 'playerTop', 'playerRight'];
    let playerSlots = playerPositions.map(pos => ({ position: pos, player: null, isTurn: false }));


    if (gameData?.status && gameData.status !== 'finished' && Object.keys(players).length > 0) {
        const maxPlayers = gameData.maxPlayers || DOMINO_CONSTANTS.MAX_PLAYERS;
        if (gameData.turnOrder && gameData.turnOrder.length === maxPlayers) {
            const turnOrder = gameData.turnOrder;
            let myIndex = 0;

            if (currentUser && !isSpectator) {
                const idx = turnOrder.indexOf(currentUser.uid);
                if (idx !== -1) {
                    myIndex = idx;
                } else {
                    console.warn("Jugador actual no encontrado en turnOrder establecido.");
                }
            }
            
            const uiOrder = new Array(maxPlayers).fill(null);
            if (maxPlayers === 4) {
                uiOrder[0] = turnOrder[myIndex];
                uiOrder[1] = turnOrder[(myIndex + 1) % maxPlayers];
                uiOrder[2] = turnOrder[(myIndex + 2) % maxPlayers];
                uiOrder[3] = turnOrder[(myIndex + 3) % maxPlayers];
            
                const rotatedPlayerSlots = [];
                rotatedPlayerSlots[0] = { pos: 'playerBottom', playerId: uiOrder[0] };
                rotatedPlayerSlots[1] = { pos: 'playerLeft', playerId: uiOrder[3] };
                rotatedPlayerSlots[2] = { pos: 'playerTop', playerId: uiOrder[2] };
                rotatedPlayerSlots[3] = { pos: 'playerRight', playerId: uiOrder[1] };
                
                playerSlots = rotatedPlayerSlots.map(slot => {
                    const player = slot.playerId ? players[slot.playerId] : null;
                    let currentScore = player?.score ?? 0;
                    if (gameData.scores) {
                        currentScore = gameData.scores[player?.team || player?.id] ?? currentScore;
                    }
                    return { ...(player || {}), position: slot.pos, isTurn: gameData.currentTurn === slot.playerId, isReady: player?.isReady || false, score: currentScore };
                });

            } else {
                const rotatedTurnOrder = [...turnOrder.slice(myIndex), ...turnOrder.slice(0, myIndex)];
                playerSlots = playerPositions.slice(0, maxPlayers).map((pos, index) => {
                    const playerId = rotatedTurnOrder[index];
                    const player = playerId ? players[playerId] : null;
                    let currentScore = player?.score ?? 0;
                    if (gameData.scores) {
                        currentScore = gameData.scores[player?.team || player?.id] ?? currentScore;
                    }
                    return { ...(player || {}), position: pos, isTurn: gameData.currentTurn === playerId, isReady: player?.isReady || false, score: currentScore };
                });
            }

        }
        else {
            const playerList = Object.values(players);
            const slots = new Array(maxPlayers).fill(null);
            let me = null;
            let myTeam = null;
            const partners = [];
            const opponents = [];


            if (currentUser && !isSpectator) {
                    me = playerList.find(p => p.id === currentUser.uid);
                    if (me) myTeam = me.team;
            }


            if (me && gameData.type === '2v2') {
                playerList.forEach(player => {
                    if (player.id === me.id) return;
                    if (player.team === myTeam) partners.push(player);
                    else opponents.push(player);
                });

                opponents.sort((a,b)=>(a.joinedAt?.toMillis() || 0) - (b.joinedAt?.toMillis() || 0));
                partners.sort((a,b)=>(a.joinedAt?.toMillis() || 0) - (b.joinedAt?.toMillis() || 0));

                slots[0] = me;
                slots[1] = opponents[0] || null;
                slots[2] = partners[0] || null;
                slots[3] = opponents[1] || null;
                
                playerSlots = [
                        { ...(slots[0] || {}), position: 'playerBottom', isTurn: false, isReady: slots[0]?.isReady || false },
                        { ...(slots[3] || {}), position: 'playerLeft', isTurn: false, isReady: slots[3]?.isReady || false },
                        { ...(slots[2] || {}), position: 'playerTop', isTurn: false, isReady: slots[2]?.isReady || false },
                        { ...(slots[1] || {}), position: 'playerRight', isTurn: false, isReady: slots[1]?.isReady || false },
                ];
            }
            else {
                let sortedPlayerList = [...playerList].sort((a,b)=>(a.joinedAt?.toMillis() || 0) - (b.joinedAt?.toMillis() || 0));

                if (me) {
                    const myIndex = sortedPlayerList.findIndex(p => p.id === me.id);
                    if (myIndex > 0) {
                        sortedPlayerList = [...sortedPlayerList.slice(myIndex), ...sortedPlayerList.slice(0, myIndex)];
                    }
                }
                for (let i = 0; i < maxPlayers; i++) {
                    if (sortedPlayerList[i]) slots[i] = sortedPlayerList[i];
                }
                
                if (maxPlayers === 4) {
                        const rotatedPlayerSlots = [];
                        rotatedPlayerSlots[0] = { pos: 'playerBottom', player: slots[0] };
                        rotatedPlayerSlots[1] = { pos: 'playerLeft', player: slots[3] };
                        rotatedPlayerSlots[2] = { pos: 'playerTop', player: slots[2] };
                        rotatedPlayerSlots[3] = { pos: 'playerRight', player: slots[1] };
                        
                        playerSlots = rotatedPlayerSlots.map(slot => {
                            const player = slot.player;
                            return { ...(player || {}), position: slot.pos, isTurn: false, isReady: player?.isReady || false };
                        });
                }
                else {
                    playerSlots = playerPositions.slice(0, maxPlayers).map((pos, index) => {
                        const player = slots[index];
                        return { ...(player || {}), position: pos, isTurn: false, isReady: player?.isReady || false };
                    });
                }
            }
        }
    }

    const playerTop = playerSlots.find(p => p.position === 'playerTop');
    const playerLeft = playerSlots.find(p => p.position === 'playerLeft');
    const playerRight = playerSlots.find(p => p.position === 'playerRight');
    const playerBottom = playerSlots.find(p => p.position === 'playerBottom');

    const currentPlayerCount = Object.keys(players).length;
    const requiredPlayers = gameData?.maxPlayers || DOMINO_CONSTANTS.MAX_PLAYERS;

    const getWinnerNames = () => {
        if (!gameData || gameData.status !== 'finished') return null;
        if (gameData.type === '2v2' && gameData.winningTeam) {
            return Object.values(players)
                .filter(p => p.team === gameData.winningTeam)
                .map(p => p.username || 'Jugador')
                .join(' y ');
        } else if (gameData.winner) {
            return players[gameData.winner]?.username || 'Jugador';
        }
        return '¿Empate?';
    };
    const winnerNames = getWinnerNames();

    // Función de formato local ya que se quitó la global
    const formatCurrencyForPool = (value) => {
        const number = Number(value) || 0;
        return new Intl.NumberFormat('es-VE', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(number);
    };


    return (
        <div className="gameContainer">
            {/* --- RENDERIZADO DEL TOAST (MODIFICADO) --- */}
            {toastMessage && (
                <div className="friendRequestToast">
                    <span>✔️</span>
                    {toastMessage}
                </div>
            )}

            {/* --- topBar (SIN CAMBIOS, LIMPIA) --- */}
            <div className="topBar">
                <div className="topLeftControls">
                    <button onClick={() => navigate('/domino')} className="gameBackToLobbyButton" title="Volver al Lobby">
                        {/* La flecha se crea con CSS ahora */}
                    </button>
                    <div className="gameTitle">{gameData?.name || `Torneo ${gameId?.substring(0, 6)}`} - Meta: {DOMINO_CONSTANTS.TARGET_SCORE_TOURNAMENT} Pts</div>
                </div>

                {/* --- ELIMINADA LA BARRA DE AVATARES DE AQUÍ --- */}

                {turnTimerRemaining !== null && gameData?.currentTurn && (
                    <div className="turnTimerDisplay">
                        Turno: {players[gameData.currentTurn]?.username || '?'} ({turnTimerRemaining}s)
                        {gameData.turnTimeoutSeconds === PASS_TIMEOUT_SECONDS && <span className='passIndicator'>(P)</span>}
                    </div>
                )}
                <div className="topRightInfo">
                    <div>Pozo: {formatCurrencyForPool(gameData?.prizePoolVES || 0)} VES</div>
                </div>
            </div>

            {/* --- CORREGIDO: Avatares de ESCRITORIO --- */}
            <div className="playerArea playerAreaTop">
                <PlayerAvatar
                    player={playerTop}
                    className="playerAvatarInArea"
                    gameData={gameData}
                    entryFee={gameData?.entryFeeVES}
                    isMe={playerTop?.id === currentUser?.uid}
                    onAddFriend={showToast}
                    isSpectator={isSpectator}
                />
                {gameData?.status === 'round_over' && playerTop?.id && playerTop.id !== currentUser?.uid && (
                    <OpponentHand hand={players[playerTop.id]?.hand} position="playerTop" />
                )}
            </div>

            <div className="middleArea" style={{ '--side-area-width': `${boardScale}px` }}>
                {/* --- CORREGIDO: Avatares de ESCRITORIO --- */}
                <div className="playerArea playerAreaLeft">
                    <PlayerAvatar
                        player={playerLeft}
                        className="playerAvatarInArea"
                        gameData={gameData}
                        entryFee={gameData?.entryFeeVES}
                        isMe={playerLeft?.id === currentUser?.uid}
                        onAddFriend={showToast}
                        isSpectator={isSpectator}
                    />
                    {gameData?.status === 'round_over' && playerLeft?.id && playerLeft.id !== currentUser?.uid && (
                        <OpponentHand hand={players[playerLeft.id]?.hand} position="playerLeft" />
                    )}
                </div>

                <div className="gameBoard">
                    {!isSpectator && (
                        <>
                            {/* El CSS ocultará este botón en móvil */}
                            <button className="settingsButton" onClick={() => setIsSettingsOpen(o => !o)}>⚙️</button>
                            
                            <button 
                                className="fullscreenButton" 
                                onClick={handleToggleFullscreen} 
                                title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
                            >
                                {isFullscreen ? '⤡' : '⤢'}
                            </button>

                            {isSettingsOpen && (
                                <div className="settingsPanel">
                                    <div className="settingsSection">
                                        <span className="settingsLabel">Fichas</span>
                                        <div className="settingsControls">
                                            <button onClick={() => handleUpdateTileScale(1)}>🔍-</button>
                                            <button onClick={() => handleUpdateTileScale(-1)}>🔍+</button>
                                        </div>
                                    </div>
                                    <div className="settingsSection">
                                        <span className="settingsLabel">Mesa</span>
                                        <div className="settingsControls">
                                            <button onClick={() => handleUpdateBoardScale(1)}>🔍-</button>
                                            <button onClick={() => handleUpdateBoardScale(-1)}>🔍+</button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {gameData?.status === 'waiting' && currentPlayerCount < requiredPlayers && (
                        <div className="waitingMessage">Esperando jugadores... {currentPlayerCount}/{requiredPlayers}</div>
                    )}
                    {gameData?.status === 'waiting' && currentPlayerCount === requiredPlayers && (!gameData.turnOrder || gameData.turnOrder.length === 0) && (
                        <div className="waitingMessage">Esperando jugadores... {currentPlayerCount}/{requiredPlayers}</div>
                    )}
                    {gameData?.status === 'full' && startCountdownRemaining !== null && (
                        <div className="waitingMessage countdownMessage">Iniciando en: {startCountdownRemaining}s</div>
                    )}
                    {gameData?.status === 'full' && startCountdownRemaining === null && (!gameData.turnOrder || gameData.turnOrder.length === 0) && !Object.values(players).every(p => p.isReady) && (
                        <div className="waitingMessage">Esperando que todos estén listos...</div>
                    )}
                    {gameData?.status === 'round_over' && (
                        <div className="waitingMessage">Ronda terminada. Siguiente ronda iniciando...</div>
                    )}
                    {gameData?.status === 'finished' && showGameOver && (
                        <div className="gameOverOverlay">
                            <div className="gameOverContent">
                                <button className="closeGameOverButton" onClick={() => setShowGameOver(false)}>X</button>
                                <h2>¡Partida Finalizada!</h2>
                                <p className="winnerAnnouncement">
                                    {gameData.type === '2v2' ? 'Equipo Ganador:' : 'Ganador:'}
                                    <br />
                                    <span className="winnerNames">{winnerNames}</span>
                                </p>
                                <div className="finalScores">
                                    <h3>Puntuación Final</h3>
                                    {gameData.type === '2v2' ? (
                                        <>
                                            <p>Equipo 1: {gameData.scores?.team1 || 0}</p>
                                            <p>Equipo 2: {gameData.scores?.team2 || 0}</p>
                                        </>
                                    ) : (
                                        Object.entries(gameData.scores || {}).map(([playerId, score]) => (
                                            <p key={playerId}>{players[playerId]?.username || 'Jugador'}: {score}</p>
                                        ))
                                    )}
                                </div>
                                <button onClick={() => navigate('/domino')} className="backToLobbyButton">Volver al Lobby</button>
                            </div>
                        </div>
                    )}

                    <div className="watermark">DOMINO</div>
                    
                    <div className="boardTilesContainer" ref={boardContainerRef}>
                        {boardLayout.map((layoutTile, index) => {
                            if (!layoutTile) {
                                console.warn("Missing layout tile at index", index);
                                return null;
                            }
                            return (
                                <div
                                    key={`board-${index}-${layoutTile.tile.top}-${layoutTile.tile.bottom}`}
                                    className="boardTileWrapper"
                                    style={{
                                        left: `${layoutTile.x}px`,
                                        top: `${layoutTile.y}px`,
                                        transform: `translate(-50%, -50%) rotate(${layoutTile.rotation}deg)`,
                                        zIndex: index,
                                    }}
                                >
                                    <DominoTile
                                        topValue={layoutTile.tile.top}
                                        bottomValue={layoutTile.tile.bottom}
                                        orientationClass={layoutTile.orientationClass} 
                                        isDouble={layoutTile.tile.top === layoutTile.bottom}
                                    />
                                </div>
                            );
                        })}
                        
                        {boardEnds.start && (
                            <div
                                className={`boardEndHighlight start ${playableEnds.start ? 'active' : ''}`}
                                style={{
                                    left: `${boardEnds.start.x}px`,
                                    top: `${boardEnds.start.y}px`,
                                    width: `${boardEnds.start.w}px`,
                                    height: `${boardEnds.start.h}px`,
                                    transform: `translate(-50%, -50%) rotate(${boardEnds.start.rotation}deg)`
                                }}
                                onClick={() => handleBoardEndClick('start')}
                            />
                        )}
                        {boardEnds.end && (
                            <div
                                className={`boardEndHighlight end ${playableEnds.end ? 'active' : ''}`}
                                style={{
                                    left: `${boardEnds.end.x}px`,
                                    top: `${boardEnds.end.y}px`,
                                    width: `${boardEnds.end.w}px`,
                                    height: `${boardEnds.end.h}px`,
                                    transform: `translate(-50%, -50%) rotate(${boardEnds.end.rotation}deg)`
                                }}
                                onClick={() => handleBoardEndClick('end')}
                            />
                        )}
                    </div>

                    {gameData?.status === 'full' && (
                        <button
                            onClick={handleToggleReady}
                            disabled={loadingAction || !players[currentUser?.uid] || isSpectator}
                            className={`readyButton ${isMyPlayerReady ? 'readyButtonActive' : ''}`}
                        >
                            {loadingAction ? '...' : (isMyPlayerReady ? '¡Listo!' : 'Marcar Listo')}
                        </button>
                    )}

                    {showPassButton && gameData?.currentTurn === currentUser?.uid && !selectedTileInfo && (
                        <button
                            onClick={handlePassTurn}
                            disabled={loadingAction}
                            className="passButton"
                        >
                            Pasar
                        </button>
                    )}
                </div>

                {/* --- CORREGIDO: Avatares de ESCRITORIO --- */}
                <div className="playerArea playerAreaRight">
                    <PlayerAvatar
                        player={playerRight}
                        className="playerAvatarInArea"
                        gameData={gameData}
                        entryFee={gameData?.entryFeeVES}
                        isMe={playerRight?.id === currentUser?.uid}
                        onAddFriend={showToast}
                        isSpectator={isSpectator}
                    />
                    {gameData?.status === 'round_over' && playerRight?.id && playerRight.id !== currentUser?.uid && (
                        <OpponentHand hand={players[playerRight.id]?.hand} position="playerRight" />
                    )}
                </div>
            </div>

            {/* --- INICIO: ÁREA INFERIOR ACTUALIZADA --- */}
            {/* Esta área contendrá AMBAS versiones (móvil y escritorio) */}
            <div className="playerArea playerAreaBottom">
                
                {/* --- Versión de ESCRITORIO (se oculta en móvil) --- */}
                <div className="desktopAvatar">
                    <PlayerAvatar
                        player={playerBottom}
                        className="playerAvatarInArea"
                        gameData={gameData}
                        entryFee={gameData?.entryFeeVES}
                        isMe={playerBottom?.id === currentUser?.uid}
                        onAddFriend={showToast} 
                        isSpectator={isSpectator}
                    />
                </div>

                {/* --- Versión MÓVIL (se oculta en escritorio) --- */}
                <div className="mobileAvatarBar">
                    <PlayerAvatar
                        player={playerBottom}
                        className="playerAvatarInArea"
                        gameData={gameData}
                        entryFee={gameData?.entryFeeVES}
                        isMe={playerBottom?.id === currentUser?.uid}
                        onAddFriend={showToast} 
                        isSpectator={isSpectator}
                    />
                    <PlayerAvatar
                        player={playerLeft}
                        className="playerAvatarInArea"
                        gameData={gameData}
                        entryFee={gameData?.entryFeeVES}
                        isMe={playerLeft?.id === currentUser?.uid}
                        onAddFriend={showToast} 
                        isSpectator={isSpectator}
                    />
                    <PlayerAvatar
                        player={playerTop}
                        className="playerAvatarInArea"
                        gameData={gameData}
                        entryFee={gameData?.entryFeeVES}
                        isMe={playerTop?.id === currentUser?.uid}
                        onAddFriend={showToast} 
                        isSpectator={isSpectator}
                    />
                    <PlayerAvatar
                        player={playerRight}
                        className="playerAvatarInArea"
                        gameData={gameData}
                        entryFee={gameData?.entryFeeVES}
                        isMe={playerRight?.id === currentUser?.uid}
                        onAddFriend={showToast} 
                        isSpectator={isSpectator}
                    />
                </div>
            </div>
            {/* --- FIN: ÁREA INFERIOR ACTUALIZADA --- */}


            {isChatOpen && (
                <div className="chatContainer">
                    <div className="chatMessages">
                        {messages.map(msg => (
                            <div key={msg.id} className="chatMessage">
                                <span className="chatUser" style={{ color: msg.userId === currentUser?.uid ? '#ffd700' : '#aaa' }}>{msg.username || '?'}:</span>
                                <span className="chatText">{msg.text}</span>
                            </div>
                        ))}
                        <div ref={chatMessagesEndRef} />
                    </div>
                    <form className="chatInputArea" onSubmit={handleSendChat}>
                        <input
                            type="text"
                            className="chatInput"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            placeholder="Escribe un mensaje..."
                            maxLength={100}
                            disabled={isSpectator}
                        />
                        <button type="submit" className="chatSendButton" disabled={isSpectator || !chatInput.trim()}>➢</button>
                    </form>
                </div>
            )}
            {isEmojiPanelOpen && (
                <div className="emojiPanel">
                    {EMOJI_REACTIONS.map(emoji => (
                        <button key={emoji} className="emojiButton" onClick={() => handleSendReaction(emoji)} disabled={isSpectator}>
                            {emoji}
                        </button>
                    ))}
                </div>
            )}

            <div className="playerHandTray">
                <div className="handTiles">
                    {myHand && myHand.map((tile, index) => {
                        if (!tile) return null;
                        const isPlayable = playableTileIndices.has(index);
                        const isSelected = selectedTileInfo?.index === index;
                        return (
                            <DominoTile
                                key={`${tile.top}-${tile.bottom}-${index}-${Math.random()}`}
                                topValue={tile.top}
                                bottomValue={tile.bottom}
                                isInHand={true}
                                isDouble={tile.top === tile.bottom}
                                isDisabled={gameData?.currentTurn !== currentUser?.uid || !isPlayable || loadingAction || gameData.status === 'round_over' || gameData.status === 'finished'}
                                isPlayableHighlight={isPlayable && !loadingAction && !selectedTileInfo && gameData?.currentTurn === currentUser?.uid && gameData.status === 'playing'}
                                isSelectedHighlight={isSelected}
                                onClick={() => handleTileClick(tile, index)}
                            />
                        );
                    })}
                </div>
                <div className="bottomIcons">
                    {/* --- CAMBIO AQUÍ: Deshabilitar si es espectador --- */}
                    <button className="iconButton" onClick={() => { setIsChatOpen(o => !o); setIsEmojiPanelOpen(false); }} disabled={isSpectator}>💬</button>
                    <button className="iconButton" onClick={() => { setIsEmojiPanelOpen(o => !o); setIsChatOpen(false); }} disabled={isSpectator}>😊</button>
                </div>
            </div>
        </div>
    );
}

export default DominoGame;