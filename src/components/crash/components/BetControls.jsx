import { useState, useEffect, useCallback } from 'react';

const BetControls = ({ gameState, onBet, onCancel, onCashout, currentBet, multiplier }) => {
    const [betAmount, setBetAmount] = useState('10.00');
    const [autoCashoutAmount, setAutoCashoutAmount] = useState('2.00');
    const [isAutoBet, setIsAutoBet] = useState(false);
    const [isAutoCashout, setIsAutoCashout] = useState(false);
    const [betForNextRound, setBetForNextRound] = useState(false);

    const handleBetAction = useCallback(() => {
        const amount = parseFloat(betAmount);
        const autoCashout = isAutoCashout ? parseFloat(autoCashoutAmount) : 0;
        onBet(amount, autoCashout);
    }, [betAmount, isAutoCashout, autoCashoutAmount, onBet]);

    useEffect(() => {
        if (gameState === 'waiting') {
            if (betForNextRound && !currentBet) {
                handleBetAction();
                setBetForNextRound(false);
            }
            else if (isAutoBet && !currentBet) {
                handleBetAction();
            }
        }
    }, [gameState, isAutoBet, betForNextRound, currentBet, handleBetAction]);

    const handleActionClick = () => {
        const state = getButtonState();
        switch (state.action) {
            case 'cashout':
                onCashout();
                break;
            case 'cancel':
                onCancel();
                break;
            case 'bet_next_round':
                setBetForNextRound(true);
                break;
            case 'cancel_next_round':
                setBetForNextRound(false);
                break;
            case 'bet_now':
                handleBetAction();
                break;
            default:
                break;
        }
    };

    const getButtonState = useCallback(() => {
        if (currentBet?.status === 'cashed_out') {
            return { text: `GANASTE ${currentBet.winnings.toFixed(2)} VES`, action: 'bet_next_round', className: "btn-success", disabled: betForNextRound };
        }
        if (gameState === 'running' && currentBet) {
            return { text: `RETIRAR ${(currentBet.bet * multiplier).toFixed(2)} VES`, action: 'cashout', className: "btn-cashout", disabled: false };
        }
        if (gameState === 'waiting' && currentBet) {
            return { text: "CANCELAR APUESTA", action: 'cancel', className: "btn-cancel", disabled: false };
        }
        if (betForNextRound) {
            return { text: "CANCELAR PRÓXIMA APUESTA", action: 'cancel_next_round', className: "btn-cancel", disabled: false };
        }
        if (gameState === 'waiting') {
            return { text: "JUGAR", action: 'bet_now', className: "btn-play", disabled: false };
        }
        if (gameState === 'running' || gameState === 'crashed') {
            return { text: "APOSTAR PARA LA SIGUIENTE", action: 'bet_next_round', className: "btn-play", disabled: false };
        }
        return { text: "JUGAR", action: 'bet_now', className: "btn-play", disabled: true };
    }, [gameState, currentBet, multiplier, betForNextRound]);

    const buttonState = getButtonState();
    const isBetPlaced = !!currentBet || betForNextRound;

    return (
        <div className="bet-panel panel p-4 flex flex-col space-y-3">
             <div className="flex items-center gap-4">
                <div className="flex flex-col items-center pt-5">
                    <label className="text-sm font-medium text-gray-400">Auto</label>
                    <div onClick={() => setIsAutoBet(!isAutoBet)} className={`toggle-switch mt-1 ${isAutoBet ? 'active' : ''}`}>
                        <div className="toggle-switch-slider"></div>
                    </div>
                </div>
                <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-400 mb-1">Monto de Apuesta</label>
                    <div className="relative">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">VES</span>
                        <input type="number" value={betAmount} onChange={(e) => setBetAmount(e.target.value)} min="3.00" max="5000.00" disabled={isBetPlaced} className="bg-gray-900 border border-gray-700 rounded-lg w-full py-2 pl-10 pr-4 disabled:opacity-50" />
                    </div>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-5">
                    {[10, 50, 100].map(p => <button key={p} onClick={() => setBetAmount(prev => (parseFloat(prev) + p).toFixed(2))} disabled={isBetPlaced} className="bg-gray-700 hover:bg-gray-600 rounded-md px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed">+{p}</button>)}
                </div>
            </div>
            <div className="flex items-center gap-4">
                <div className="flex flex-col items-center pt-5">
                    <label className="text-sm font-medium text-gray-400">Auto</label>
                    <div onClick={() => setIsAutoCashout(!isAutoCashout)} className={`toggle-switch mt-1 ${isAutoCashout ? 'active' : ''}`}>
                        <div className="toggle-switch-slider"></div>
                    </div>
                </div>
                <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-400 mb-1">Retiro Automático</label>
                    <div className="relative">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">@</span>
                        <input type="number" value={autoCashoutAmount} onChange={(e) => setAutoCashoutAmount(e.target.value)} placeholder="2.00" disabled={isBetPlaced || !isAutoCashout} className="bg-gray-900 border border-gray-700 rounded-lg w-full py-2 pl-7 pr-4 disabled:opacity-50" />
                    </div>
                </div>
                 <div className="grid grid-cols-3 gap-2 pt-5">
                    {[2, 5, 10].map(m => <button key={m} onClick={() => setAutoCashoutAmount(m.toFixed(2))} disabled={isBetPlaced || !isAutoCashout} className="bg-gray-700 hover:bg-gray-600 rounded-md px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed">{m}x</button>)}
                 </div>
            </div>
            <div className="w-full mt-2 flex gap-2">
                 {currentBet?.status === 'cashed_out' && !betForNextRound ? (
                    <>
                        <div className="w-1/2 py-3 rounded-xl text-lg font-bold btn-success text-center">
                            GANASTE {currentBet.winnings.toFixed(2)} VES
                        </div>
                        <button onClick={() => setBetForNextRound(true)} className="w-1/2 py-3 rounded-xl text-lg font-bold btn-play">
                            APOSTAR PARA LA SIGUIENTE
                        </button>
                    </>
                ) : (
                    <button onClick={handleActionClick} disabled={buttonState.disabled} className={`w-full py-3 rounded-xl text-lg font-bold transition-all duration-300 ${buttonState.className}`}>
                        {buttonState.text}
                    </button>
                )}
            </div>
        </div>
    );
};

export default BetControls;