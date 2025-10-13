import { useRef, useEffect, useCallback, useState } from 'react';

const GameAnimation = ({ gameState, multiplier, countdown }) => {
    const gridCanvasRef = useRef(null);
    const bgCanvasRef = useRef(null);
    const [rocketPosition, setRocketPosition] = useState({ x: 10, y: 30 });
    const [gridOffset, setGridOffset] = useState(0);

    // Efecto para el fondo estrellado
    useEffect(() => {
        const canvas = bgCanvasRef.current; if (!canvas) return;
        const ctx = canvas.getContext('2d');
        let stars = []; let animationFrameId;
        const init = () => {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = canvas.offsetWidth * dpr; canvas.height = canvas.offsetHeight * dpr;
            ctx.scale(dpr, dpr);
            stars = [];
            for (let i = 0; i < 200; i++) stars.push({ x: Math.random() * canvas.offsetWidth, y: Math.random() * canvas.offsetHeight, radius: Math.random() * 1.2 + 0.5, alpha: Math.random() * 0.5 + 0.5, twinkleSpeed: Math.random() * 0.015 });
        };
        const drawAndUpdate = () => {
            ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            stars.forEach(star => {
                star.alpha += star.twinkleSpeed;
                if (star.alpha > 1 || star.alpha < 0.3) star.twinkleSpeed *= -1;
                if (gameState === 'running' && multiplier > 1.5) { star.y += 0.5; if (star.y > canvas.offsetHeight) { star.y = 0; star.x = Math.random() * canvas.offsetWidth; } }
                ctx.globalAlpha = star.alpha; ctx.beginPath(); ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2); ctx.fill();
            });
            ctx.globalAlpha = 1;
            animationFrameId = requestAnimationFrame(drawAndUpdate);
        };
        init(); drawAndUpdate();
        window.addEventListener('resize', init);
        return () => { cancelAnimationFrame(animationFrameId); window.removeEventListener('resize', init); };
    }, [gameState, multiplier]);

    // Función para dibujar la cuadrícula
    const drawGrid = useCallback((yPixelOffset = 0) => {
        const canvas = gridCanvasRef.current; if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvas.offsetWidth * dpr; canvas.height = canvas.offsetHeight * dpr;
        ctx.scale(dpr, dpr);
        const width = canvas.offsetWidth; const height = canvas.offsetHeight;
        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'; ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.font = '12px Poppins'; ctx.setLineDash([2, 4]);

        const yMultiplierRange = 1.0;
        const pixelsPerMultiplier = (height * 0.9) / yMultiplierRange;
        const startMultiplier = 1.0 + (yPixelOffset / pixelsPerMultiplier);
        const yStep = 0.25;
        const firstLineMultiplier = Math.floor(startMultiplier / yStep) * yStep;

        for (let i = 0; i < 7; i++) {
            const currentMultiplier = firstLineMultiplier + i * yStep; if (currentMultiplier < 1) continue;
            const yPos = height - ((currentMultiplier - startMultiplier) * pixelsPerMultiplier) - (height * 0.05);
            ctx.beginPath(); ctx.moveTo(0, yPos); ctx.lineTo(width, yPos); ctx.stroke();
            ctx.fillText(currentMultiplier.toFixed(2) + 'x', 10, yPos - 5);
        }
        for (let i = 1; i <= 5; i++) {
            const x = (i / 6) * width;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
        }
    }, []);

    // Actualizar la posición del cohete y la cuadrícula
    useEffect(() => {
        const gameScreen = document.querySelector('.game-screen');
        if (!gameScreen) return;

        const launchpadY = 30;
        const launchpadX = 10;

        if (gameState === 'waiting' || gameState === 'loading') {
            setRocketPosition({ x: launchpadX, y: launchpadY });
            setGridOffset(0);
            return;
        }

        if (gameState === 'running') {
            const pixelsPerMultiplierUnit = gameScreen.clientHeight * 0.8;
            const totalTravelY = (multiplier - 1) * pixelsPerMultiplierUnit;
            const scrollThreshold = gameScreen.clientHeight * 0.4;

            const rocketY = launchpadY + Math.min(totalTravelY, scrollThreshold);
            const newGridOffset = totalTravelY > scrollThreshold ? totalTravelY - scrollThreshold : 0;

            const horizontalProgress = Math.min((multiplier - 1) / 10, 1);
            const rocketX = launchpadX + (horizontalProgress * 70);

            setRocketPosition({ x: rocketX, y: rocketY });
            setGridOffset(newGridOffset);
        }
    }, [multiplier, gameState]);

    useEffect(() => {
        drawGrid(gridOffset);
        const handleResize = () => drawGrid(gridOffset);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [gridOffset, drawGrid]);


    const showRoundElements = gameState === 'running' || gameState === 'crashed';

    return (
        <div className="game-screen flex flex-col items-center justify-center">
            <canvas ref={bgCanvasRef} id="background-canvas"></canvas>
            <canvas ref={gridCanvasRef} id="game-grid"></canvas>

            {gameState === 'waiting' && (<div id="game-status" className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/50 px-4 py-2 rounded-lg font-semibold z-30">Iniciando ronda en {countdown.toFixed(1)}s</div>)}

            {showRoundElements && (
                <div id="multiplier-display" className={`multiplier ${gameState === 'crashed' ? 'crashed' : ''}`}>
                    {multiplier.toFixed(2)}x
                </div>
            )}

            <div
                id="rocket"
                style={{
                    left: `${rocketPosition.x}%`,
                    bottom: `${rocketPosition.y}px`,
                    opacity: gameState === 'crashed' ? 0 : 1,
                    display: gameState === 'loading' ? 'none' : 'block'
                }}
                className={gameState === 'running' ? 'is-flying' : ''}
            >
                🚀
            </div>

            {gameState === 'crashed' && (
                <div
                    id="explosion"
                    style={{
                        left: `calc(${rocketPosition.x}% - 150px)`,
                        top: `calc(100% - ${rocketPosition.y}px - 150px)`
                    }}
                    className="active"
                >
                    <svg className="explosion-svg" viewBox="0 0 200 200"><circle className="flash" cx="100" cy="100" r="100" /><g stroke="orange"><path className="spark" d="M100 100 L180 100" /><path className="spark" d="M100 100 L155 155" /><path className="spark" d="M100 100 L100 180" /><path className="spark" d="M100 100 L45 155" /><path className="spark" d="M100 100 L20 100" /><path className="spark" d="M100 100 L45 45" /><path className="spark" d="M100 100 L100 20" /><path className="spark" d="M100 100 L155 45" /></g></svg>
                </div>
            )}
        </div>
    );
};

export default GameAnimation;