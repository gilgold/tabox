import React from 'react';
import { IoColorPalette } from 'react-icons/io5';
import { FaCalendarAlt } from 'react-icons/fa';
import { BiText } from 'react-icons/bi';

export const SortType = {
    COLOR: (a, b) => (b.color > a.color) ? -1 : ((a.color > b.color) ? 1 : 0),
    DATE: (a, b) => b.lastUpdated && a.lastUpdated ? b.lastUpdated - a.lastUpdated : b.createdOn - a.createdOn || 0,
    NAME: (a, b) => (a.name > b.name) ? 1 : ((b.name > a.name) ? -1 : 0)
}

export const sortOptions = [
    { value: 'COLOR', label: "Color", icon: <IoColorPalette /> },
    { value: 'DATE', label: "Date", icon: <FaCalendarAlt /> },
    { value: 'NAME', label: "Name", icon: <BiText /> }
]