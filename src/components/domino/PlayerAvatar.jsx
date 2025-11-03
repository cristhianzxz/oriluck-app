import React, { useState } from 'react';
import './DominoGame.css'; // Importamos los mismos estilos

// Moviendo la función de formato aquí
const formatCurrency = (value) => {
    const number = Number(value) || 0;
    return new Intl.NumberFormat('es-VE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(number);
};

// Exportamos el componente para que DominoGame.jsx pueda importarlo
export const PlayerAvatar = ({ player, className, entryFee, gameData, isMe, onAddFriend, isSpectator }) => {
    const { username, name = 'En espera', score = 0, avatar, flag = '🏳️', isTurn, currentReaction, isReady } = player || {};
    const displayName = username || name;
    const turnClass = isTurn ? 'isTurn' : '';
    const readyClass = isReady ? 'isReadyGlow' : '';

    const [isHovered, setIsHovered] = useState(false);

    const handleAddFriendClick = (e) => {
        e.stopPropagation(); // Prevenir que otros clics se disparen
        e.preventDefault();
        
        // Doble chequeo por si acaso, aunque el hover no debería activarse
        if (onAddFriend && player?.id && !isMe && !isSpectator) {
            onAddFriend("Solicitud de amistad enviada");
            // Aquí se llamaría a la función de backend en el futuro
            // ej: sendFriendRequest(player.id);
        }
        setIsHovered(false); // Ocultar el botón después de hacer clic
    };

    return (
        <div 
            className={`avatarContainer ${className || ''} ${isTurn ? 'isTurnContainer' : ''} ${!player ? 'waiting' : ''}`}
            // --- CAMBIO AQUÍ: Añadido '!isSpectator' ---
            onMouseEnter={() => !isMe && player && !isSpectator && setIsHovered(true)}
            onMouseLeave={() => !isMe && player && !isSpectator && setIsHovered(false)}
        >
            <div className={`avatarImageWrapper ${turnClass} ${readyClass}`}>
                <img src={avatar || '/default-avatar.png'} alt={displayName} className="avatarImage" />
                
                {/* Reacciones y otros indicadores */}
                {currentReaction && (
                    <span className="playerReaction">{currentReaction}</span>
                )}
                {player && isReady && gameData?.status === 'full' && (!gameData.turnOrder || gameData.turnOrder.length === 0) && (
                    <span className="readyIndicator">✓</span>
                )}
            
                {/* --- BOTÓN DE AÑADIR AMIGO Y OVERLAY --- */}
                {/* Esto ahora no se mostrará si isSpectator es true, porque isHovered no se activará */}
                {isHovered && !isMe && player && (
                    <>
                        <div className="avatarImageOverlay"></div>
                        <button className="addFriendButton" onClick={handleAddFriendClick} title={`Añadir a ${displayName} como amigo`}>
                            +
                        </button>
                    </>
                )}
            </div>

            <div className="playerInfo">
                <div className="name">
                    <span className="flag">{flag}:</span> {displayName}
                </div>
                {player && (
                    <div className="balanceCount">
                        <span className="currencySymbol">VES</span>
                        {formatCurrency(entryFee)}
                    </div>
                )}
            </div>

            {player && <div className="scoreBadge">{score}</div>}
        </div>
    );
};