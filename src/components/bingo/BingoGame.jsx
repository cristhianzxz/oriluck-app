import React, { useEffect, useState, useContext, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthContext } from '../../App';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';

const BingoGame = () => {
  const { currentUser } = useContext(AuthContext);
  const location = useLocation();
  const navigate = useNavigate();
  const initialTournament = location.state?.tournament || null;

  const [tournament, setTournament] = useState(initialTournament);
  const [loading, setLoading] = useState(!initialTournament);
  const [userCards, setUserCards] = useState([]);
  const [showWinners, setShowWinners] = useState(false);

  useEffect(() => {
    if (!initialTournament) {
      navigate('/bingo', { replace: true }); // Si no hay torneo, volver al lobby de bingo
      return;
    }
    const ref = doc(db, 'bingoTournaments', initialTournament.id);
    const unsub = onSnapshot(ref, snap => {
      if (snap.exists()) {
        const data = { id: snap.id, ...snap.data() };
        setTournament(data);
      } else {
        navigate('/bingo', { replace: true });
      }
      setLoading(false);
    }, e => {
      console.error('Error listening tournament:', e);
      setLoading(false);
      navigate('/bingo', { replace: true });
    });
    return () => unsub();
  }, [initialTournament, navigate]);

  useEffect(() => {
    if (!tournament || !currentUser) return;
    const sold = tournament.soldCards || {};
    const mine = Object.keys(sold)
      .filter(k => sold[k].userId === currentUser.uid)
      .map(k => ({
        cardNumber: parseInt(k.replace('carton_', ''), 10),
        cardNumbers: sold[k].cardNumbers || []
      }))
      .sort((a, b) => a.cardNumber - b.cardNumber);
    setUserCards(mine);
  }, [tournament, currentUser]);

  useEffect(() => {
    if (tournament?.status === 'finished' && (tournament.winners?.length || 0) > 0) {
      setShowWinners(true);
    }
  }, [tournament?.status, tournament?.winners]);

  const calledNumbers = tournament?.calledNumbers || [];
  const currentNumber = tournament?.currentNumber || null;

  const soldCount = useMemo(
    () => Object.keys(tournament?.soldCards || {}).length,
    [tournament?.soldCards]
  );
  const pricePerCard = tournament?.pricePerCard || 0;
  const computedPrizeTotal = soldCount * pricePerCard * 0.7;
  const prizeTotal = tournament?.prizeTotal && tournament.prizeTotal > 0
    ? tournament.prizeTotal
    : computedPrizeTotal;

  const safeWinners = useMemo(() => {
    const winners = tournament?.winners || [];
    if (!winners.length) return [];
    const perWinnerFallback = winners.length ? (prizeTotal / winners.length) : 0;
    return winners.map(w => ({
      ...w,
      prizeAmount: (w.prizeAmount && w.prizeAmount > 0) ? w.prizeAmount : perWinnerFallback
    }));
  }, [tournament?.winners, prizeTotal]);

  const buildMatrix = (flat) => {
    if (!Array.isArray(flat) || flat.length !== 25) return Array.from({ length: 5 }, () => Array(5).fill(null));
    const m = [];
    for (let c = 0; c < 5; c++) {
      m[c] = [];
      for (let r = 0; r < 5; r++) {
        m[c][r] = flat[c * 5 + r];
      }
    }
    return m;
  };

  const isMarked = (value) => {
    if (value === 'FREE') return true;
    return calledNumbers.includes(value);
  };

  if (loading || !tournament) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 text-white">
        Cargando juego...
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-8 bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 text-white">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white/5 rounded-xl p-4 md:p-6">
          <div>
            <h1 className="text-3xl font-extrabold">🎰 BINGO EN VIVO</h1>
            <div className="text-white/60 text-sm mt-1">
              {tournament.name} <br />
              {tournament.startTime?.toDate
                ? tournament.startTime.toDate().toLocaleString('es-VE')
                : ''}
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => navigate('/bingo')}
              className="bg-gray-600 hover:bg-gray-500 px-4 py-2 rounded-lg text-sm"
            >
              ← Volver al Bingo
            </button>
            <button
              onClick={() => navigate('/lobby')}
              className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm"
            >
              🎮 Sala de Juegos Principal
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-6">
            <div className="border border-yellow-400/40 rounded-xl p-6 bg-gradient-to-b from-purple-800/20 to-purple-900/20">
              <div className="text-center text-sm tracking-widest text-yellow-300 mb-3">
                NÚMERO ACTUAL
              </div>
              <div className="text-center text-6xl font-black text-yellow-300 drop-shadow">
                {currentNumber ?? '--'}
              </div>
              <div className="mt-4 text-center text-white/60 text-sm">
                {calledNumbers.length}/75 números cantados
              </div>
            </div>

            <div className="border border-teal-500/40 rounded-xl p-5 bg-teal-900/20">
              <div className="text-center font-semibold text-teal-300 mb-1">
                {tournament.status === 'finished'
                  ? '🏁 FINALIZADO'
                  : tournament.status === 'active'
                    ? '🎲 JUGANDO'
                    : '⏳ ESPERA'}
              </div>
              <div className="text-center text-white/60 text-sm">
                {tournament.status === 'active'
                  ? 'La bolita está girando...'
                  : tournament.status === 'finished'
                    ? 'Revisa los ganadores.'
                    : 'Esperando inicio.'}
              </div>
            </div>

            <div className="border border-purple-500/40 rounded-xl p-5 bg-purple-900/30">
              <div className="font-semibold mb-2">Información</div>
              <div className="text-sm space-y-1 text-white/70">
                <div>Cartones vendidos: <span className="text-white">{soldCount}/100</span></div>
                <div>Premio total (70%): <span className="text-green-400 font-semibold">Bs. {prizeTotal.toLocaleString()}</span></div>
                <div>Tus cartones: <span className="text-yellow-300">{userCards.length}</span></div>
              </div>
            </div>

            <div className="border border-purple-500/30 rounded-xl p-5 bg-purple-800/20 max-h-72 overflow-y-auto">
              <div className="font-semibold mb-2">Últimos Números</div>
              <div className="flex flex-wrap gap-2">
                {calledNumbers.slice().reverse().map(n => (
                  <div key={n} className="w-10 h-10 flex items-center justify-center rounded-full bg-purple-600/40 text-sm font-bold">
                    {n}
                  </div>
                ))}
                {calledNumbers.length === 0 && (
                  <div className="text-white/50 text-sm">Aún no hay números.</div>
                )}
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 space-y-6">
            <h2 className="text-2xl font-bold">
              Tus Cartones ({userCards.length})
            </h2>

            {userCards.length === 0 && (
              <div className="p-6 border border-white/10 rounded-xl bg-white/5 text-white/60">
                No tienes cartones en este torneo.
              </div>
            )}

            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
              {userCards.map(card => {
                const matrix = buildMatrix(card.cardNumbers);
                return (
                  <div
                    key={card.cardNumber}
                    className="bg-purple-800/30 border border-purple-500/30 rounded-xl p-4"
                  >
                    <div className="text-center mb-2 text-sm text-white/70">
                      Cartón #{card.cardNumber}
                    </div>
                    <div className="grid grid-cols-5 gap-1 text-xs font-bold">
                      {['B', 'I', 'N', 'G', 'O'].map(l => (
                        <div key={l} className="text-center text-pink-300">
                          {l}
                        </div>
                      ))}
                      {matrix.flat().map((val, idx) => {
                        const marked = isMarked(val);
                        return (
                          <div
                            key={idx}
                            className={`h-8 flex items-center justify-center rounded ${
                              val === 'FREE'
                                ? 'bg-green-600/60 text-white text-[10px]'
                                : marked
                                  ? 'bg-green-500 text-white'
                                  : 'bg-white/10 text-white/80'
                            } text-[11px]`}
                          >
                            {val === 'FREE' ? 'FREE' : val}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {showWinners && safeWinners.length > 0 && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-gradient-to-br from-purple-900 to-gray-900 border border-purple-500/40 rounded-2xl max-w-xl w-full p-6 space-y-4">
              <h3 className="text-2xl font-bold text-center">🏆 Ganadores</h3>
              <div className="text-center text-white/70 text-sm">
                Premio total repartido: Bs. {prizeTotal.toLocaleString()}
              </div>
              <div className="space-y-3">
                {safeWinners.map((w, i) => (
                  <div key={i} className="bg-white/10 p-4 rounded-xl">
                    <div className="font-semibold">{w.userName}</div>
                    <div className="text-white/70 text-sm">
                      Cartón(es): #{w.cards.join(', ')}
                    </div>
                    <div className="text-yellow-300 font-bold text-lg">
                      Premio: Bs. {w.prizeAmount.toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setShowWinners(false)}
                className="w-full mt-2 bg-green-600 hover:bg-green-500 py-3 rounded-lg font-semibold"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BingoGame;