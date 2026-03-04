/**
 * Hook to dynamically set page title based on organization branding
 * Shows "{ABBREVIATION} O&M System" for tenant routes
 * Shows "O&M System - SPHAiRDigital" for platform routes
 */

import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getCurrentOrganizationBranding, getApiBaseUrl } from '../api/api';

/**
 * Get company abbreviation from organization name
 * @param {string} name - Organization name
 * @returns {string} Abbreviation (e.g., "SIE" for "Smart Innovations Energy")
 */
function getCompanyAbbreviation(name) {
  if (!name) return '';
  const words = name.split(' ').filter(w => w.length > 0);
  if (words.length === 1) {
    return name.substring(0, 3).toUpperCase();
  }
  return words.map(word => word.charAt(0).toUpperCase()).join('').substring(0, 5);
}

/**
 * Hook to set page title dynamically
 * @param {string} customTitle - Optional custom title (overrides default)
 */
export function usePageTitle(customTitle = null) {
  const location = useLocation();
  const { user, isSuperAdmin } = useAuth();
  const [organizationAbbreviation, setOrganizationAbbreviation] = useState(null);

  useEffect(() => {
    const setTitle = async () => {
      // If custom title provided, use it
      if (customTitle) {
        document.title = customTitle;
        return;
      }

      const isTenantRoute = location.pathname.startsWith('/tenant/');
      const isPlatformRoute = location.pathname.startsWith('/platform/');

      // Platform routes: Show "O&M System - SPHAiRDigital"
      if (isPlatformRoute) {
        document.title = 'O&M System - SPHAiRDigital';
        return;
      }

      // Tenant routes: Show "{ABBREVIATION} O&M System"
      if (isTenantRoute) {
        // For system owners: Check sessionStorage for selected organization
        if (isSuperAdmin()) {
          const selectedOrgName = sessionStorage.getItem('selectedOrganizationName');
          if (selectedOrgName) {
            const abbrev = getCompanyAbbreviation(selectedOrgName);
            document.title = `${abbrev} O&M System`;
            setOrganizationAbbreviation(abbrev);
            return;
          }
        }

        // For regular users: Use their organization
        if (user?.organization_name) {
          const abbrev = getCompanyAbbreviation(user.organization_name);
          document.title = `${abbrev} O&M System`;
          setOrganizationAbbreviation(abbrev);
          return;
        }

        // Try to load branding from API if organization info not in user object
        if (user?.organization_id) {
          try {
            const response = await getCurrentOrganizationBranding();
            if (response.data) {
              // company_name_display might be the abbreviation or full name
              // If it's short (<= 5 chars), use it directly; otherwise extract abbreviation
              let abbrev;
              if (response.data.company_name_display) {
                const displayName = response.data.company_name_display.trim();
                // company_name_display is in format "SIE O&M System" or "Smart Innovations Energy O&M System"
                // Extract abbreviation (text before " O&M System")
                if (displayName.includes(' O&M System')) {
                  abbrev = displayName.split(' O&M System')[0].trim();
                } else if (displayName.length <= 5 && displayName === displayName.toUpperCase()) {
                  // Already an abbreviation (no " O&M System" suffix)
                  abbrev = displayName;
                } else {
                  // Extract abbreviation from full name
                  abbrev = getCompanyAbbreviation(displayName);
                }
              } else if (user?.organization_name) {
                abbrev = getCompanyAbbreviation(user.organization_name);
              } else {
                // Fallback: try to get organization name from API
                const orgResponse = await fetch(`${getApiBaseUrl()}/organizations/${user.organization_id}`, {
                  credentials: 'include'
                });
                if (orgResponse.ok) {
                  const org = await orgResponse.json();
                  abbrev = getCompanyAbbreviation(org.name);
                }
              }
              
              if (abbrev) {
                document.title = `${abbrev} O&M System`;
                setOrganizationAbbreviation(abbrev);
                return;
              }
            }
          } catch (error) {
            console.warn('Error loading organization branding for title:', error);
          }
        }

        // Fallback: Try to get from organization name in user object
        if (user?.organization_name) {
          const abbrev = getCompanyAbbreviation(user.organization_name);
          document.title = `${abbrev} O&M System`;
          setOrganizationAbbreviation(abbrev);
          return;
        }
      }

      // Default title
      document.title = 'O&M System - SPHAiRDigital';
    };

    setTitle();
  }, [location.pathname, user, isSuperAdmin, customTitle]);

  return organizationAbbreviation;
}
