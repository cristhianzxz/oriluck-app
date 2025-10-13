import { useState, useEffect, useCallback } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../firebase';

export const usePlayerBets = (currentUser, gameState, multiplier, addToast) => {
    const [activeBets, setActiveBets] = useState([]);
    const [currentBet, setCurrentBet] = useState(null);
    const [autoCashoutTarget, setAutoCashoutTarget] = useState(0);

    // Listener para apuestas activas en la ronda
    useEffect(() => {
        const playersRef = collection(db, 'game_crash', 'live_game', 'players');
        const unsub = onSnapshot(playersRef, (snapshot) => {
            const betsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setActiveBets(betsData);
            if (currentUser) {
                const userBet = betsData.find(bet => bet.userId === currentUser.uid);
                setCurrentBet(userBet || null);
            }
        });
        return () => unsub();
    }, [currentUser, gameState]);

    const handleCashout = useCallback(async () => {
        if (gameState !== 'running' || !currentBet || currentBet.status !== 'playing') return;

        try {
            const cashOutFunc = httpsCallable(functions, 'cashOut_crash');
            await cashOutFunc();
            addToast('¡Retiro exitoso!', 'success');
        } catch (error) {
            console.error("Error al retirar:", error);
            addToast(error.message, 'error');
        }
    }, [gameState, currentBet, addToast]);

    // Lógica para el retiro automático
    useEffect(() => {
        if (
            gameState === 'running' &&
            currentBet &&
            currentBet.status === 'playing' &&
            autoCashoutTarget > 0 &&
            multiplier >= autoCashoutTarget
        ) {
            handleCashout();
        }
    }, [multiplier, gameState, currentBet, autoCashoutTarget, handleCashout]);

    const handleBet = async (amount, autoCashoutValue) => {
        if (!currentUser || amount < 3) {
            addToast('Monto de apuesta inválido.', 'error');
            return;
        }
        try {
            const placeBetFunc = httpsCallable(functions, 'placeBet_crash');
            await placeBetFunc({ amount });
            setAutoCashoutTarget(autoCashoutValue || 0);
            addToast('¡Apuesta realizada!', 'success');
        } catch (error) {
            console.error("Error al realizar la apuesta:", error);
            addToast(error.message, 'error');
        }
    };

    const handleCancelBet = async () => {
        addToast('Función para cancelar no implementada.', 'info');
    };

    return {
        activeBets,
        currentBet,
        handleBet,
        handleCashout,
        handleCancelBet,
    };
};