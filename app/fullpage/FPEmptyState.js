import React from 'react';
import './FPEmptyState.css';

function FPEmptyState({ icon, title, description, actions, imageSrc, imageAlt }) {
    return (
        <div className={`fp-empty-state${imageSrc ? ' fp-empty-state-has-image' : ''}`}>
            {imageSrc && (
                <img
                    className="fp-empty-image"
                    src={imageSrc}
                    alt={imageAlt || ''}
                />
            )}
            {!imageSrc && icon && <div className="fp-empty-icon">{icon}</div>}
            <h3 className="fp-empty-title">{title}</h3>
            {description && <p className="fp-empty-description">{description}</p>}
            {actions && actions.length > 0 && (
                <div className="fp-empty-actions">
                    {actions.map((action, i) => (
                        <button
                            key={i}
                            className="fp-empty-action-btn"
                            onClick={action.onClick}
                        >
                            {action.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default FPEmptyState;
