import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';

export const usePersonalHistory = (currentUser, currentBet) => {
    const [myBets, setMyBets] = useState([]);

    useEffect(() => {
        if (!currentUser?.uid) {
            setMyBets([]);
            return;
        };

        const q = query(
            collection(db, "crash_bets_history"),
            where("userId", "==", currentUser.uid),
            orderBy("timestamp", "desc"),
            limit(20)
        );

        const unsub = onSnapshot(q, (snapshot) => {
            const historicalBets = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    bet: data.bet,
                    status: data.status,
                    winnings: data.winnings || 0,
                    cashOutMultiplier: data.cashOutMultiplier,
                    crashPoint: data.crashPoint,
                    timestamp: data.timestamp?.toDate().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }) || ''
                };
            });

            if (currentBet) {
                const activeBetEntry = {
                    id: 'active-bet',
                    bet: currentBet.bet,
                    status: 'playing',
                    timestamp: 'Ahora'
                };
                setMyBets([activeBetEntry, ...historicalBets]);
            } else {
                setMyBets(historicalBets);
            }
        });

        return () => unsub();
    }, [currentUser, currentBet]);

    return myBets;
};