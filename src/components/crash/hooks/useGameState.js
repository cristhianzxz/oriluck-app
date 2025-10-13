import { useState, useEffect, useRef } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';

export const useGameState = () => {
    const [gameState, setGameState] = useState('loading'); // loading, waiting, running, crashed
    const [multiplier, setMultiplier] = useState(1.00);
    const [countdown, setCountdown] = useState(0);
    const [crashPoint, setCrashPoint] = useState(0);

    const animationFrameRef = useRef();
    const intervalsRef = useRef({});

    useEffect(() => {
        const unsub = onSnapshot(doc(db, 'game_crash', 'live_game'), (snap) => {
            if (!snap.exists()) {
                setGameState('loading');
                return;
            }

            const data = snap.data();
            const currentServerState = data.gameState;
            setGameState(currentServerState);

            const cleanup = () => {
                clearInterval(intervalsRef.current.countdown);
                cancelAnimationFrame(animationFrameRef.current);
            };

            cleanup();

            if (currentServerState === 'waiting') {
                setMultiplier(1.00);
                setCrashPoint(0);
                intervalsRef.current.countdown = setInterval(() => {
                    const timeLeft = data.wait_until.toMillis() - Date.now();
                    setCountdown(Math.max(0, timeLeft / 1000));
                }, 100);
            } else if (currentServerState === 'running') {
                const startTime = data.started_at.toMillis();
                const k = data.rocketPathK;

                const animate = () => {
                    const elapsed = (Date.now() - startTime) / 1000;
                    const currentMultiplier = Math.exp(elapsed * k);
                    setMultiplier(currentMultiplier);
                    animationFrameRef.current = requestAnimationFrame(animate);
                };
                animationFrameRef.current = requestAnimationFrame(animate);

            } else if (currentServerState === 'crashed') {
                setMultiplier(data.crashPoint);
                setCrashPoint(data.crashPoint);
            }
        });

        const intervals = intervalsRef.current;
        const animationFrame = animationFrameRef.current;
        return () => {
            unsub();
            clearInterval(intervals.countdown);
            cancelAnimationFrame(animationFrame);
        };
    }, []);

    return { gameState, multiplier, countdown, crashPoint };
};