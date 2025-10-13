import { usePersonalHistory } from '../hooks/usePersonalHistory';

const PersonalHistory = ({ currentUser, currentBet }) => {
    const myBets = usePersonalHistory(currentUser, currentBet);

    const getDisplayInfo = (bet) => {
        if (bet.id === 'active-bet') {
            return { text: 'En Proceso...', color: 'text-yellow-400', multiplier: '-' };
        }

        if (bet.status === 'cashed_out') {
            const profit = bet.winnings - bet.bet;
            return {
                text: `+${profit.toFixed(2)} VES`,
                color: 'text-green-400',
                multiplier: `@ ${bet.cashOutMultiplier.toFixed(2)}x`
            };
        }

        return {
            text: `-${bet.bet.toFixed(2)} VES`,
            color: 'text-red-400',
            multiplier: `@ ${(bet.crashPoint || 1).toFixed(2)}x`
        };
    };

    return (
        <div className="flex-grow overflow-y-auto text-sm space-y-2 pr-2">
            {myBets.length === 0 && (
                <div className="text-center text-gray-500 mt-4">No tienes apuestas recientes.</div>
            )}
            {myBets.map((bet) => {
                const display = getDisplayInfo(bet);
                return (
                    <div key={bet.id} className="grid grid-cols-3 gap-2 items-center bg-gray-900/50 p-2 rounded-md">
                        <span className="font-semibold">{bet.timestamp}</span>
                        <span className="text-center font-semibold">{display.multiplier}</span>
                        <span className={`text-right font-semibold ${display.color}`}>
                            {display.text}
                        </span>
                    </div>
                );
            })}
        </div>
    );
};

export default PersonalHistory;