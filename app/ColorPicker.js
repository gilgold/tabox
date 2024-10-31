import React, { useEffect, useState } from 'react';
import { Popover } from 'react-tiny-popover';
import ReactTooltip from 'react-tooltip';

function ColorPicker(props) {

    const [color, setColor] = useState(props?.currentColor ?? 'var(--bg-color)');
    const [showPicker, setShowPicker] = useState(false);
    const [selectedColorCircle, setSelectedColorCircle] = useState(0);

    const colorList = props.colorList ?? [
        'var(--bg-color)',
        '#B60205',
        '#D93F0B',
        '#FBCA04',
        '#0E8A16',
        '#1D76DB',
        '#0052CC',
        '#6330e4',
        '#f78786',
        '#f1bc97',
        '#f3e3a2',
        '#95e6b2',
        '#acf4f9',
        '#99bdff',
        '#C5DEF5',
        '#6294dc',
        '#b499f7'
    ];

    useEffect(() => {
        setColor(props?.currentColor ?? 'var(--bg-color)')
        if (props.currentColor) {
            const colorIndex = colorList.findIndex(element => element === props.currentColor);
            setSelectedColorCircle(colorIndex);
        }
    }, [props.currentColor]);

    useEffect(() => {
        ReactTooltip.rebuild();
        return () => setShowPicker(false);
    }, []);

    const handleChange = async (color, index) => {
        setColor(color);
        setSelectedColorCircle(index);
        props.action(color, props.group ?? null);

    };

    const handleClick = () => {
        setShowPicker(!showPicker);
    };

    const handleClose = (e) => {
        if (e && ['colorOption'].includes(e.target.className)) return;
        setShowPicker(false);
    };

    return <Popover
        isOpen={showPicker}
        positions={['right']} // preferred positions by priority
        onClickOutside={handleClose}
        content={
            <div className="popover">
                {colorList.map((_color, index) => index === 8 ?
                    <div className="break" key={'breaker'} /> :
                    <div
                        key={`color-${index}`}
                        onClick={async () => await handleChange(_color, index)}
                        className={`colorOption`}
                        style={{ backgroundColor: _color }}>
                        <div className={`selectedInnerCircle ${index === selectedColorCircle ? 'selected' : ''}`} />
                    </div>
                )}
            </div>}
    >
        <div onClick={handleClick} className="colorPickerWrapper" data-tip-disable={showPicker} data-tip={props.tooltip}>
            <div className="colorPicker" style={{ borderColor: color === 'var(--bg-color)' ? 'var(--settings-row-text-color)' : color }} onClick={handleClick}>
                <div className="currentColor" style={{ backgroundColor: color }} />
            </div>
        </div>
    </Popover>;
}

export default ColorPicker;
